# PSO-like (three.js) — Design Decisions

Living spec agreed during the kickoff interview. Gameplay first, graphics later.

## Scope — First Playable
- **Hub city** → teleporter → **Forest 1** (handcrafted, ~8–10 rooms) → **Dragon-style boss**.
  Expedition 2 (Caves → De Rol Le), Expedition 3 (Mines → Warden) and Expedition 4 (Ruins → Dark Falz) follow;
  see their sections below.
- Target run length for a fresh character: **~15–20 min**; each floor is a checkpoint (see Death & Saves).
- **Single-player only.** No networking plans.
- **Normal, Nightmare and Hell**, chosen at login, Diablo style (Nightmare opens after Dark Falz on Normal, Hell after it falls on Nightmare; see "Nightmare" and "Hell"). No Section IDs yet.
- **Endgame:** Falz Rifts after the Hell Dark Falz: generated rifts on a 16-tier ladder, modded by Rift Shards (see
  "Endgame: Falz Rifts").
- **Crafting:** photons change a weapon's or armour's affixes, each spending the item's Potential; every item is fully
  ground (no grinders since 2026-10-11, see "Grind: built in"); formerly grinders raised base
  stats on weapons and armour (see "Crafting: Photons").

## Tech
- **TypeScript + Vite + three.js**.
- **lil-gui** debug panel for live-tuning combat numbers (timing windows, damage, crits, enemy stats).
- Game data (items, enemies, rooms, drop tables) lives in typed data files / JSON.
- Saves go to **localStorage** and autosave in the hub.

## Controls (keyboard + mouse only)
- WASD movement, mouse-orbit third-person camera.
- **The camera picks the target** (2026-10-16, the user's ask; Tab lock-on until then, F before 2026-10-14): the
  enemy nearest the middle of the view (within 16° of it, seen from the camera; the current one holds on out to 24°
  and wins near-ties, so neighbours don't flicker), ahead of her, on screen, never through walls, and **within reach
  of her bar**: the farthest the photon bolt (13 m) or a slotted Art reaches (Foie 18 m). The target frame and reticle show exactly while that holds, so walking up
  to an enemy you look at brings its frame up the moment it is in range, and backing off drops it. There is no
  lingering frame after a hit any more. The camera never turns by itself. Attacks auto-face the target.
  - **Bolts and techniques aim with the camera only**: they go to the target, or with none along the camera
    (toward a target too far for that attack: a bolt falls short). Zonde and Barta need a target ("No target"), and
    one past their reach while Foie's longer one shows it says "Out of range" (nothing spent; the slot's icon goes
    red). Rafoie and Razonde land on the target, else on the enemy nearest the camera's line, else 8 m out (or as far
    as they reach toward a target past them).
- **C** snaps the camera behind the player.
- **Attacks** (2026-10-14, see "Arts"): **LMB** is the basic chain; **RMB, Q, E and R** are the four Art slots
  (Menu → Arts). The HUD's hex cluster shows them with their TP cost. The photon blast fires
  by itself once the Mag has taught one and its gauge is full (key 2 until 2026-10-11). Until 2026-10-14 this was
  the action palette: two rows swapped with Shift, LMB heavy / RMB light weapon or magic, the mouse wheel cycling
  Foie / Zonde / Barta, Q / E quick slots.
- **Key 1** always uses the injector (see Injectors).
- **Space** interacts when something is in reach (talk, pick up, pull switches, break boxes; the prompt says
  what), otherwise **Space + a direction** dashes (see Dash): Space alone does nothing until a direction is pressed
  while it is held; one dash per press. (R was the interact key from 2026-10-07; it is an Art slot now.)
- Menus (inventory, shop) **pause the game**, so nothing can be used from them: the inventory has no Use button.
  Injectors are used with key 1 and support techniques from the Art bar, in real time.

## Combat — PSO-faithful
- **3-step chain.** Each step is the basic attack or an Art (see "Arts"), and chaining needs **rhythm timing**
  (mashing breaks the chain).
- **The basic attack** (2026-10-14; the old light hit): a homing photon bolt (tech damage × the kind's bolt power),
  0.6 stagger (the finisher double), and every step that lands refills TP. Until 2026-10-21 melee and guns hit every
  enemy in their kind's shape for ×0.7 instead.
  Until 2026-10-14 each step was Light or Heavy: heavy was ×1.3 damage to the aimed enemy, a slower swing, 1.5
  stagger, double knockback and the weapon special's roll; the Arts took its place.
- A **visual timing cue** (subtle flash/ring) marks the chain window.
- **Perfect window**: the first moments of the chain window (0.1 s by default). The ring lands gold, the weapon
  glints and the window-open tick sounds; pressing then is a perfect chain (chime, gold HUD pip). Perfect chains
  in a row build a streak that scales damage ×1.0 / ×1.15 / ×1.4. A later press in the window still chains but
  resets the streak to ×1.0.
- **Rhythm per weapon kind**: the quick Wand has a tight perfect window and short grace, the slow Rod wide ones.
- **Nothing misses** (2026-10-09, the user's call): what connects lands, both ways. ATA and EVP are gone (see
  "Stats: no ATA, no EVP"). In an action game the aiming, positioning and dash already decide hits; the dice roll
  on top only punished twice (heavy had been a flat 15% whiff at its 85% cap, light hit 100% past the Caves, and
  enemies landed 96-100% of hits everywhere but the Forest). Heavy went from x1.5 at 85% to **x1.3**, always.
  - (Until 2026-10-21 guns lost damage past their range and melee hit ×1.52, ranged ×1.58: see "One character: no
    classes".)
- **Stagger meter** instead of a flinch roll: each hit adds points and the enemy flinches when they reach its
  poise (Booma 1, Gobooma 2, Gigobooma 3, Pan Arms 5, elites +1). A bolt or technique adds 0.6 per enemy (the
  single-target techniques 2-2.5×, Conductor doubles it), a photon blast 1.5. The bolt finisher counts double. Hits
  landing during a wind-up count double, and the meter drains after 1.2 s without hits.
- Attacks commit you, and positioning is the defence. The **dash** is the way out, at a price.

### Crowd control on enemies (2026-10-16)
The user's call after a Razonde storm kept whole packs stunned (each strike rolled a 2 s stun that restarted any
running one, and the strikes flinched a Booma every 2nd strike, every strike with Conductor): crowd control (stun,
freeze, slow, knockback) is something enemies shrug off by a fixed chance each. **No diminishing returns**: the
chance never changes from repeated casts (the user: it should always affect a mob, at its own odds).
- **CC affixes** (`ccResist.ts`, config `crowdControl`): a second set apart from the elite affixes, each a % chance to
  resist one kind: **Steadfast** (stun), **Insulated** (freeze), **Relentless** (slow), **Anchored** (knockback).
  Every application rolls it. How many a mob rolls (regular / elite / champion; a fraction is the chance of one
  more) and how strong, rolled evenly in the range:
  - Normal 0 / 0.5 / 0.5 at 15-25%; Nightmare 0.3 / 1 / 2 at 20-35%; Hell 1 / 1.5 / 2 at 30-45%.
  - Rifts: Hell's, +1.5% a tier up to tier 16 (`riftCfg.capTier`, like armour) and one more affix at every rank
    from tier 10. Shard modifiers can give one to every enemy (see "Modifiers and Rift Shards").
  - Never above 75%: only bosses are immune. Each affix is a different kind. Rooted mobs (Lilies, the Control
    Node) can't be knocked back at all and never roll Anchored; the Control Node rolls none. Splitting copies come
    plain. Frenzied counts as stun-immune once it has frenzied.
- **Rules** (all CC lands through `Combat.stun / freeze / chillTarget / shove / pull`, which roll `resisted`):
  - An effect with its own odds (a lightning stun, Crescent's Shock, the Ice and Shock specials) rolls those first,
    silently, and only then the resistance, so RESIST shows only when resistance stopped something.
  - A stun or freeze never lands on a mob already stunned or frozen (it isn't extended: the mob acts again when the
    first one ends). A plain flinch doesn't count.
  - Zones (ice fields, sticky napalm) roll once per enemy per zone; re-rolling every tick would land within a few.
  - Knockback on ordinary hits rolls silently; the deliberate shoves and pulls (Push, Blast, Breathing Room, Point
    Blank, Concussive, Vortex) float RESIST. RESIST floats at most once a second per enemy, IMMUNE every 2 s.
- **Storm ticks don't flinch:** Razonde's strikes and Rabarta's pulses (all but the freezing last one) add no
  stagger. They still deal damage and roll their stun or chill.
- **Lightning stuns stop scaling, and a storm stuns once** (same day: the user found Razonde still stun-locked
  whatever the resistance). The stun chance is the technique's own 12% × Kindle (1.5) × Paralyze (2), at most 36%;
  it used to add 0.03% per point of tech damage, which made 81-100% a strike with Paralyze and Kindle from Lv 46 on.
  Razonde rolls its stun once per enemy per cast, on the first strike that reaches it (spent if it's already
  stunned), not on every strike: with a strike every 0.375 s and casts overlapping, a mob got about five tries a
  second, so a 2 s stun came back within half a second at any resistance. Measured on a Lv 90 Hell Force recasting
  every 1.5 s (Paralyze, Kindle) against a Booma: stunned 89% / 84% / 77% of the time at 0 / 45 / 75% stun
  resistance before (0-2 attacks a minute), 33% / 16% / 10% after (12 / 16 / 16 attacks a minute; 22 with no
  storm on it).
- **Bosses** are immune to all four. Chill no longer slows a boss's whole fight (it did, telegraphs included, down
  to ×0.75), and stuns no longer pretend to stagger one. Burn, poison, venom, weaken, mark and sunder still land.
- **Frames:** the enemy frame has a row of chips under the affixes, glyph and % (`⚡ 40%`, or `⚡ immune`), only
  for the kinds it has, bigger than the affix chips (14 px bold, 18 px glyphs). A landed slow gets a badge like stun
  and freeze. The boss bar shows "Immune" with the four glyphs, and the burns and poisons running on it (hidden
  before). Same day, the user's calls: the frame went dark and nearly opaque with larger text (the see-through red
  panel was hard to read), and immunities lost a red strike-through over the glyph.
- Considered and left out (2026-10-16): tenacity (each landed stun or freeze raising resistance for a while), a fixed
  immunity window after each one, and Monster Hunter style buildup meters.

### Stats: no ATA, no EVP (2026-10-09)
(Superseded in its names and units by "Stats: named by what they do" below: LCK is Crit chance, ATP Weapon damage,
MST Tech damage, DFP went.)
The user asked whether misses should go (casters never missed; melee and guns could), then asked to cut the
attributes that only pay off late, since Mag points are permanent ("it will be too late to understand the value of
armour piercing till you get to Hell"). Turned down on the way: ATA as armour piercing (its value only shows on Hell),
DEX as crits only (+0.2% damage a point: a trap next to POW), and cutting the Mag to three stats (Hunter and Ranger
would be the same build).
- **Six stats**: HP, TP, ATP, DFP, MST, **LCK** (plus Haste from gear). LCK took over ATA's numbers: class base and
  growth (Hunter 50 + 1.2 a level, Ranger 70 + 1.8, Force 45 + 1), and the requirement of guns, slicers and Combat
  armour (the old ATA tables, unchanged). Weapons lost their ATA (and Edge its ATA share); armour lost EVP; the
  Combat line's ATA bonus became LCK.
- **Crits**: chance = LCK / 10 % (up to 75%), weapon hits and attack techs deal **x2**; Resta heals and Shifta /
  Deband boosts crit at x1.5 (`formulas.critPerLck / critCap / critDamage / critSupport`). Lv 38: Hunter ~9%,
  Ranger ~14%, Force ~8%; Lv 98: about 17% / 25% / 14%.
- **Mag DEX** = **ATP +2.5, LCK +2** (POW is ATP +3, HP +3): a little less raw power and no HP, plus crits.
  POW is worth slightly more a point early, DEX slightly more late; for a Force, MIND. **The Mag tab shows what the
  next point in POW / DEX / MIND adds to damage per second** against the current expedition's average enemy, so the
  choice can be weighed when it is made (`magPointValue`).
- The weapon card's damage estimate counts crits on average, so LCK gear shows in the ▲ verdict.
- Retune to keep kill times: melee x1.65 -> x1.52, ranged x1.5 -> x1.58, techniques x0.94
  (`techScaling.damageMult`), Nightmare enemy and boss HP x1.04, Hell x1.08 (crits grow with level). Forest enemies
  kept their ATP: they now always hit, but the bot took no more damage there than before.
- Affixes: ATA (of Precision) and EVP (of Grace) went, and so did the heavy hit-chance cap (of the Eagle) and its
  97% cap. Reach now delays the damage falloff. LCK rolls 3-40 (was 1-20, at half the crit per point). Reckless's
  penalty is DFP. Old saves load: ATA rolls become LCK and EVP rolls DFP (same value).
- Talents: **Deadeye** is now heavy shots +12% and half the range falloff (was a 95% heavy hit cap).

### Stats: named by what they do (2026-10-14)
The user asked for affixes like crit chance, crit damage, technique damage and weapon damage, then for every stat to
be named after what it does ("crit should be crit"), shown in the unit you feel, so stats need no descriptions. Their
calls, from my proposals: **Weapon damage % multiplies the whole hit**, a **Crit damage** affix, a **Strike / Area
damage taken** split, and the full version: formulas changed so each number is literal, not just relabelled.
- **Stats** (code keys unchanged, so saves load): HP, TP, **Weapon damage** (`atp`), **Tech damage** (`mst`),
  **Crit chance** (`lck`, kept in tenths of a percent: 24 = 2.4%), **Strike damage taken** and **Area damage taken**
  (`strike` / `area`, % less, each capped at 75%: `AFFIX_CAPS.damageTaken`), plus **Crit damage** (×2 base) and Haste.
  The status screen lists them with a live Foie / Resta note for Tech damage and nothing else; the long tooltips went.
- **Weapon hits** = (Weapon damage + the weapon's own roll) × (1 + Weapon damage %) × Farlla's attack buff × the swing's multiplier
  (light ×0.7, heavy ×1.3) × the kind's and the family's (melee ×1.52, ranged ×1.58), less the enemy's **armour %**.
  DFP used to come off ATP before a ÷5 × 0.9; enemy HP went up **×5.56** (1 / 0.18) so the hits and kill times held.
- **Techniques** = tech damage × the technique's multiplier (Foie 278%, Zonde 362%, Barta 251%, before the form's
  ×0.5 / ×1.35), less the enemy's **technique resistance %**: in proportion to tech damage now (it grew with MST^1.2).
  Heals and TP cost scale with tech damage as they did with MST. Farlla's defence buff takes 40% of its % off both
  damage-taken stats (35%: −14%). (Shifta and Deband did the same until they went on 2026-10-15.)
- **Enemy armour and technique resistance** are plain % (was DFP and MDF). Fitted per enemy and per band by a
  script (2026-10-14), so a reference Hunter / Ranger / Force (Mag unspent, no affixes, the band's gear, the SETUPS
  levels) keeps its old kill time: the analytic estimate is within 2% at every band. Armour comes out 7-22% on
  Normal (Booma 7, Chaos Bringer 22), Nightmare and Hell add −4 to +4 points per expedition (players out-scale it).
  Technique resistance replaces the old MDF curve: in proportion to tech damage, a Force's techniques fell behind
  the old MST^1.2 at high levels, so the multipliers were raised ×1.33 and resistance sits at 0-20% on Normal
  (highest in the Forest), 2-14% on Nightmare and 14-21% on Hell. Rifts add armour +0.25 and resistance +0.8 a tier.
- **Damage taken**: enemy ATP × 0.35, less your Strike (direct swings and shots) or Area (telegraphed areas, boss
  attacks, hazards and boss ticks) damage taken %. Sources: the class (Hunter 2 + 0.25 a level, Ranger 1 + 0.17,
  Force 0.1 a level), **armour** (each frame and barrier cuts both, by line and tier: Guard 5-21% / 4-18%, Combat
  4-15% / 3-12%, Psy 3-11% / 2-9%; Rift-forging raises it), the Mag's defense track (−0.25% both a point), Deband
  and affixes. Enemy ATP was refit per enemy so the **class-average** hit stays what it was at each band; flat
  damage (breath and beam ticks, the laser wall, Mines hazards) was scaled by the old DFP / 300 cut's share.
  - What changed underneath: subtracting DFP made a Guard-armoured Hunter nearly immune to ordinary enemies on
    Nightmare and Hell (hits of 1), while a Force took the full force. A % cut can't do that, so Hunters now take a
    real share of every hit and Forces less: per hit, the Hunter takes 1.6-2.4x the old on Normal and much more on
    Nightmare and Hell (where it was ~1), the Ranger about the same, the Force 0.65-0.75x. See the balance check below.
- **Requirements are levels**, about where the tier starts dropping, so the gear of the area you are in can be worn
  (`TIER_LEVEL`: T2 Lv 3, T5 18, T7 32 (Ruins), T8 42 (Nightmare), T11 72, T12-15 80 / 84 / 89 / 93; injectors T3-6
  Lv 7 / 15 / 24 / 42). Stat requirements went: "Needs Crit 9%" would have been one, and the Mag no longer
  unlocks gear. A first try at the item level itself locked Nightmare and Hell drops for too long (the Mag used to
  pull a dedicated build 15-20 levels under its tier's stat). Any class can wear any line of its level; weapon
  passives still follow the weapon family. The test characters are Lv 76 now (tier 11 gear).
- **Mag tracks** are named by what a point gives: **Weapon + HP** (3, 3), **Weapon + Crit** (2.5, 0.2%), **Tech + TP**
  (3, 2), **Defense + HP** (damage taken −0.25% both, HP +4). Code keys pow / dex / mind / def, colours and forms
  unchanged.
- **Affixes**: Weapon damage % (Cruel) and Reckless roll the Tech damage % and Brittle numbers (3-28%, 5-30%), since
  they multiply the whole hit now (old rolls come down to their tier's new top). New **Crit damage** prefix (Savage,
  weapons and units, +6-55%). Crit chance (of Luck) shows as % (+0.3-4.0%). **Plated** (Strike damage taken, was DFP
  +2-45) and **Warded** (Area damage taken, was the barrier-only Bastion suffix) are both armour prefixes of 1-8%,
  so a Photon Crystal trades one for the other. Brittle and Reckless cost "Damage taken +1-7%" (both stats).
  Red Ring: Crit damage +100%.
- **Old saves** convert once (`affixUnits` 2): DFP rolls become Strike damage taken (÷6), Bastion ×2/3, the downside
  penalties ÷6, Weapon damage % and Reckless capped at their new tops. Learned DFP units are Strike units.

### Dash
Agreed 2026-10-07, after the Mines' overlapping telegraphs, leaping Sinows and Garanz barrages made committed
combos feel like traps. The combos stay slow; the dash gives a way out that costs something.
- **Pure movement, no invulnerability:** ~3.5 m in 0.22 s (fast start, slow finish). Telegraphs still have to be
  read: you dash *out of* a circle or lane, not through it. One Gillchic lane or one missile blast is clearable,
  a carpet you stood in the middle of is not. Bodies and walls stop it like walking.
- **2 charges**, refilling one at a time (4.5 s each). Chevrons on a tab at the HP/TP frame's bottom-left edge
  fill as they recharge; trying with none flashes the tab red.
- **Cancels whatever you were doing** and can start any time you aren't in hitstun or paralysed: a swing still
  in its windup never lands, the chain and its perfect streak are lost, a cast in progress fizzles with its TP
  spent. So the choice is "finish the finisher, or get out?". Injectors can be used
  mid-dash (a dose is instant), and a dash cancels the drinking pose.
- A short **recovery** (0.15 s) after it blocks attacks and casts, so it is no free gap-closer. Walking and a
  second dash are fine.
- **Direction:** camera-relative WASD, and she turns to face it. **With a target** (the camera's), W / S close in or
  back off and A / D circle it at the same distance, so it doubles as a strafe while she keeps facing it.
- Each dash **sheds one Burn stack** and counts as moving.
- A photon streak on the floor marks the path; `player.dash` sound (3 variants in the sound lab).
- Tuning panel: **Dash** folder. Passives change it: **Fleet** (+1 charge), **Slipstream** (dash out of a telegraph
  and the next attack or cast lands perfect), **Blink** (an almost instant dash through enemies), and Light Feet /
  Rush (faster recharge). (Lunge and Backstep Shot, the Hunter's and Ranger's, went on 2026-10-21.)

### Dash checks (bosses)
Added 2026-10-07 so the bosses ask for the dash at set moments, not all the time. A **dash check** is an area
whose escape distance walking can't cover in the warning time but walking plus one dash can. Tuning rule:
walking clears about 4.6 m/s × (warning − ~0.35 s reaction); a dash adds ~2.5 m on top. Checks get a
**pulsing cyan rim** on their telegraph (`dash.cueTelegraphs`), and until a character has dashed 5 times the
first ones show a toast naming the key. Everything else stays walkable. Verified in the sim (react 0.35 s,
then walk or dash straight out):

| Boss | Check | Walk | Dash must start by |
| --- | --- | --- | --- |
| Dragon | **Eruption** (every burrow): 6 m circle on you, 1.6 s | fails, even at 0.2 s reaction | ~0.7 s |
| Dragon | **Enraged stomp** (7 m, faster windup) when hugging it | fails from melee range | ~0.5 s+ |
| De Rol Le | **Phase 2 lane slams** (7 m lane, 1.0 s; both of the pair) | fails | ~0.65 s (enraged ~0.45 s) |
| De Rol Le | **Bomb ring**: the last volley of every phase 2 barrage, 8 bombs at 3.2 m plus one on you | fails | ~0.6 s (enraged ~0.45 s) |
| Warden | **Phase 2 hand slams** (3.5 m circle on you, 1.0 s; both of the pair) | fails from the middle (walks ~3 m of the ~3.9 needed) | not measured yet |
| Dark Falz | **Teleport slam** (form 2: 4.2 m circle on you as it vanishes, 1.3 s) | fails at a 0.35 s reaction (a very quick 0.25 s one just makes it) | ~1.0 s (from standing still: ~0.8 s) |
| Dark Falz | **Lance** (form 3: a 7 m lane across the altar through you, 1.0 s) | fails from its middle (~3 m of 3.95) | not measured yet |

Phase 1 of De Rol Le and the Warden stays walkable (wider lane, longer windups) so the shapes can be
learned first. Pairs (De Rol Le's double slam, the Warden's double hand slam) fit the 2 charges; spending
them carelessly just before one is the risk. Bot balance runs can't show any of this (the bot never moves out
of anything).
- **Weapon kinds**: two since 2026-10-21, the **Rod** (the pure caster's weapon: technique boost ×1.2, a heavy, slow
  bolt at 0.9× tech damage, TP refill ×1.5) and the **Wand** (×1.1, quick bolts at 0.55×, TP refill ×2.2). They fire
  photon bolts (2026-10-14) and differ in speed, rhythm and the boost. Twelve kinds until 2026-10-14 and eight until
  2026-10-21; the melee weight classes (light / medium / heavy, Poise, 2026-10-07) went with the blades. See "One
  character: no classes".
- **Techniques: no disks, MST only** (agreed 2026-10-07, replacing technique disks and tech levels). Every class
  knows all six techniques from Lv 1; **MST** (base + Mag + gear) is the only thing that scales them, so a Hunter
  or Ranger who doesn't build MST has weak spells and a Force grows into hers as she levels. Why: disks were a chore,
  not a choice (the shop restocked all six at about Lv/5 and the right move was always "learn the highest"), and
  ranks double-scaled with MST. Support techs barely scaled with MST before (Shifta / Deband not at all), so
  without class caps a Hunter would have got a stronger Resta and Shifta than she has now; they now scale too.
  Each tech lists its power and TP at MST 100 (`techScaling.mstRef`; constants in `config/` `techScaling`):
  - Attack damage = power × (MST / 100)^1.2 × weapon technique boost (Foie 40, Zonde 52, Barta 36). The exponent
    makes a Force pull ahead: ~10× a pure-ATP Hunter's Foie at Lv 42.
  - TP cost = tp × (0.4 + 0.6 × MST / 100) (Foie 4.5, Zonde 5.5, Barta 6.5, Resta 5, Shifta / Deband 6). High MST
    costs more per cast (the user's call), but damage grows faster than cost, so a Force gets more damage per TP.
  - **Resta** heals 0.6 HP per MST: the MST build heals clearly more at the same level (a Lv 42 Force about 65%
    of her bar, a pure-ATP Hunter about 5%). **Shifta / Deband**: 6.5% per 100 MST, capped at 35%, 60 s.
  - Zonde's stun chance got +0.03% per MST (gone on 2026-10-16: at endgame tech damage it reached 100% a strike; see
    "Crowd control on enemies"). Foie always burns (40% of the hit's damage over 3 s) and Barta always
    chills (25% slower movement and attacks for 3 s, bosses too until 2026-10-16: they are immune to slow now).
    Neither stacks: a new burn only replaces the running one if it has more damage left, chill just refreshes.
    Boss Burn is uncapped now (Poison keeps its cap). (2026-10-10: Burn used to be a chance and tick 5 + MST / 40;
    freeze was the same 2 s lockout as Zonde's stun, and bosses ignored both.)
  - Fitted to keep a Force's damage close to the old curve (shop-rank disks). Measured heavy Foie, Force with a
    rod and Psy armor, no Mag MIND: 33 / 92 / 151 / 279 at Lv 1 / 12 / 22 / 42 (MST 64 / 144 / 217 / 363; the old
    system gave about 40 / 82 / 125 / 264). Lv 42 Hunter / Ranger (MST 56): heavy Foie 27, Resta 34 HP (5%),
    Shifta 4%. Light Foie casts per full TP bar go ~20 → ~33 over the game.
  - Old saves: learned levels are dropped and leftover disks refunded at their sell price. Drops: misc rolls are
    grinders only now (misc weight 7 → 3; the old disk share went to weapons 16 → 18 and armor 9 → 11; the
    grind rework later doubled misc to 6).
  - The planned technique mods (Foie splits, Zonde chains to 5, Barta ice field, Resta cleanses) became Force
    talents (2026-10-08: behaviour lives in talents, items carry numbers); staves roll technique affixes instead.
    Advanced techs (Gi- / Ra- tiers, Megid): skipped for now.
- **Spell forms** (2026-10-10 to 2026-10-14; replaced by nine attack techniques, each its own Art, Forces only:
  see "Arts"): attack techniques had a light (area) and a heavy (single target) form, like weapons, every class
  could cast them, and each element had a job (Zonde picks off and stuns, Foie burns, Barta slows). Light Foie was
  a lobbed fire bomb, heavy a homing fireball; Zonde chained to 3 / one big bolt; Barta a 5 m ice ring around you /
  an ice spike. Light: ×0.5 power; heavy ×1.35 power and ×1.3 TP.
- **Cast chains**: techniques chain like combo steps (they are Arts now): one cast in the window becomes the next
  step, with the same perfect window, streak damage and too-early break. Resta and the buffs chain too (they only
  cast from idle until 2026-10-14).

## One character: no classes (2026-10-21)
Agreed and built 2026-10-21. The user: making fights fun and hard for melee, guns and techniques at once was too
hard to balance, so the game keeps the Force and drops the class idea altogether. Every character is the same caster,
and nothing in the game names a class. Their picks from a question round:
- **Rod and Wand only.** The six melee and gun kinds went (Saber, Sword, Dagger, Handgun, Rifle, Shot), and with them
  every system only they used: swings, two-handed holds and the swing trail (`/swinglab.html` too), gun shots and
  damage falloff, weight classes, Poise and lunges, the melee / ranged damage multipliers, weapon specials (they only
  rolled on weapon hits), and the 24 Hunter and Ranger Arts with their modifiers. Bare hands fire a weak bolt
  (`BARE_KIND`: bolt power 0.4, no technique boost).
- **Weapon damage is gone** (`atp`): bolts and techniques use Tech damage only. Rods and wands carry Tech damage as
  their base (the same numbers as before, raised by the built-in Edge grind). The Weapon damage stat, its affixes
  (Cruel, Heavy, Reckless) and the Power unit went. **Farlla now gives Tech damage +35%**: it gave weapon damage,
  which did nothing for a caster. Mylla & Youlla deals 5× a hit of your main technique.
- **The Mag has two tracks**, MIND (Tech + TP) and DEF (Defense + HP). POW and DEX went with their forms, and their
  points come back to spend: a one-time exception to Mag points being permanent. The first form is always Vritra.
- **One armour line, Psy** (plus the plain starters and the Photon Barrier). Guard and Combat went. She always wears
  the robe (Halo), and the frame's tier still picks the evolution stage. Vanguard and Ember stay in `/armorlab.html`
  as a reference.
- **Stats and growth** are the Force's (`BASE_STATS`, `GROWTH`): HP 70 + 7.5 a level, TP 80 + 6, Tech damage 60 + 4,
  Crit chance 4.5% + 0.1%, damage taken −0.1% a level. A new character starts with a Wand and a Fluid injector and
  knows Foie.
- **Skills**: the Fire, Lightning and Ice trees. Five general passives from the Hunter and Ranger trees joined them
  (the user's pick): **Bloodlust** (Fire), **Light Feet** (Lightning), **Last Stand**, **Bulwark** and **Field Medic**
  (Ice). Adrenaline (weapon hits only) and every melee and gun passive went.
- **One Art bar** (it was one per weapon kind; techniques don't care what you hold). No Art has a cooldown.
- **Loot**: every weapon drop is a rod or wand and every armour drop Psy (drops leaned 80% to the class before);
  injectors lean Fluid (35% Mate). The main-pool uniques no longer favour a class.
- **Uniques**: the six made for Hunters and Rangers became rods and wands, keeping their names and bosses (the
  user's pick). Two unique units changed as well: the Limiter (its shorter cooldowns did nothing for a caster) and
  Dragon Rush (its hit is a photon bolt now).

  | Unique | Now | Effect | Cost |
  |---|---|---|---|
  | Dark Flow | Wand | As before: kills heal 5% max HP and remove a Corruption stack | Mate injectors don't work |
  | Frozen Shooter | Rod | Ice techniques freeze; any technique on a frozen enemy shatters it for ×2.5 (then 3 s before it can freeze again) | 50% less damage (bolts too) to anything not frozen; bosses never freeze |
  | Flame Visit | Rod | Burning deaths leave fire pools (as before); Rafoie's burning ground lasts twice as long | You Burn in your own fire |
  | Dragon Fang | Wand | Rampage as before; at 10 stacks techniques cost no TP | A hit for 15% of max HP or more ends Rampage |
  | Ophelie Seize | Wand | Every photon bolt adds a venom stack, no cap; a poisoned enemy's stacks jump on its death | Photon bolts can't crit |
  | S-Beat's Blade | Wand | A technique as a perfect chain's 3rd step (bolt, bolt, technique) costs no TP | Techniques not cast as the 3rd step cost double TP |
  | Limiter (unit) | Unit | Techniques cast 30% faster | Techniques cost 20% more TP |

  Dragon Fang's free techniques and the Limiter's cast speed were my recommended pitches, used as the defaults.
- **Kept as it was**: Delsaber's guard (single-target techniques that stagger harder than a bolt break it: Foie,
  Zonde, Barta, Rafoie; bolts and area techniques are blocked from the front), the dash and the dash checks, the
  Pioneer 2 crowd's HUmar / RAmarl / FOmarl looks (NPCs, not something the player picks), the unique armour's damage
  cut (between the old Guard and Combat lines), and every Force number: no retune, so the tuning made with the Force
  still holds.
- **Old saves** (save version 6; version 5 saves load and convert in `convertRetiredItems`, `readAffixData` and the
  `Character` constructor): blades and the Cane become a Rod, guns a Wand, Guard and Combat armour Psy, each of the
  same tier. Affixes that went are dropped and `upgradeCrafting` tops the item back up to its counts. Specials and
  the class go. A Hunter or Ranger starts the trees over: she knows Foie, like a new character, and every other
  point comes back (her Art bars go too). A Force keeps her ranks, and her old Art bars (one per weapon kind) become
  the bar of the weapon in hand. POW and DEX points come back.
- **Menus**: character creation lost its class step (body, hair, face gear, colours, name). Class names went from
  the slot list, the nameplate, the menu title and the status screen (which shows the growth per level instead),
  and so did the Weapon damage rows and the melee and gun rows of Other stats. The Damage tab and item cards show
  your main technique and the photon bolts.
- **Dev tools**: `__h.start(slot, difficulty)`; the debug panel makes one Lv 76 test character (rod and wand rares,
  Psy armour). `.claude/simsetup.js`: `mkChar(lvl, weapon, frame, barrier, passives)`, `simRun(...)` (was
  `simClass`), and SETUPS per band with a rod (`rodF1` ... `rodXR`), some with a wand too (`wandF1`, `wandF`,
  `wandC`, `wandHF`, `wandXF`). The sim bot casts first (`seq ['a', 'a', 'a']`; `window.botSeq` overrides it).
- **Not done**: no balance pass. The balance references in this file from before 2026-10-21 were measured with
  Hunters and Rangers (the h* / r* setups) and need re-baselining with the rod and wand setups. Enemy **armour %**
  now affects nothing (only weapon hits read it) but is still in the enemy data and the Nightmare, Hell and rift
  scaling. The melee and gun sounds (`swing.blade`, `shot.*`) and the humanoid gun grips stay in their catalogues,
  unused by the player.

## Arts (2026-10-14)
Agreed and built 2026-10-14, replacing light / heavy attacks, the spell forms, the action palette and talents. The
user, bored at rift tier 16, asked for separate abilities you keybind and use in different situations, "like Path of
Exile abilities or Diablo spells": pure area ones, single target ones with debuffs. Their calls: **generator +
spender**; Arts come **from the weapon kind**; customisation by **Art modifiers**, and talents removed completely
(they became passives, see "Classes, the Mag and passives"); **LMB basic chain, RMB / Q / E / R Arts**, lock-on on Tab
only (gone 2026-10-16: the camera picks the target), key 1 injector, Space dash and interact; a Force's basic chain is a **free photon bolt**; the photon blast is
picked **on the Mag tab**. Data in `data/arts.ts`, behaviour in `combat/arts.ts`.
- **Generator + spender.** The **basic chain** (LMB, `basicAttack`) costs nothing, and every step that lands
  refills TP: 6% of the class's base TP at your level, the finisher ×2, a perfect step ×1.5, × the kind's
  `tpRefill` (Rod 1.5, Wand 2.2, the rest 1); Focus ×1.5, Siphon Staff ×2 on bolts. There is no other TP regen
  (Fluid injectors still refill). **Arts spend it**: a weapon Art costs a share of the class's base TP (`tpPct`,
  8-25%), a technique its MST-based cost.
- **Casters' basic chain** is a **photon bolt** (13 m, 24 m/s): tech damage × the kind's `boltPower` (Rod 0.9,
  Wand 0.55). Rods and wands don't swing any more.
- **Arts chain.** An Art pressed in the chain's window becomes the next step and gets the perfect streak, so
  basic, basic, Art is the rhythm. Channels (Cyclone, Rapid Volley, Blade Dance), guards and movement Arts **seal**
  the chain (it ends after them). Some have cooldowns (Leap 6 s, Guard Stance 10 s, War Cry 15 s). Weapon specials
  (Heat, Ice...) roll on the basic finisher and on single-target Arts' strong hits.
- **Four slots** (RMB, Q, E, R), **one bar** (one per weapon kind until 2026-10-21). An untouched bar fills itself in
  learning order, so a slot never moves as Arts are learned; an Art learned in Skills goes into the first empty slot
  once you have changed the bar. Menu → Arts: click a slot, then an Art. Changes wait for the end of a fight; in the city only support Arts work.
- **Where they come from**: the nine attack techniques and Resta (Lv 1). Until 2026-10-21 Hunters and Rangers had
  weapon Arts instead (three per weapon kind and three per family: Cyclone, Rising Edge, Rapid Volley, Charged
  Shot, Leap, Grenade and the rest); they went with the classes. Shifta and Deband (Lv 10, the buffs) were removed
  on 2026-10-15 at the user's call ("remove Shifta and other utility spells"; Resta stays); Farlla keeps their effect.

- **Techniques** (Forces): Lv 1 **Foie** (homing fireball, burns), **Zonde** (jumps to two more, may stun), **Barta**
  (ice spike, chills); Lv 12 **Gibarta** (an ice wave ahead), 15 **Gifoie** (a fire ring around you), 20 **Gizonde**
  (three bolts in a fan); Lv 28 **Rabarta** (a 3 s blizzard that freezes at the end), 36 **Rafoie** (a meteor and
  burning ground), 46 **Razonde** (a 3 s storm, eight strikes). Base TP 10 / 14 / 18 by tier, Resta 15, through the MST
  formula (`techTpCost`). The fire / lightning / ice damage affixes (foie / zonde / barta
  % until now) cover each element's three.
- **Razonde's strikes per enemy** (2026-10-16, the user's call): each enemy takes at most 3 of a storm's 8 strikes
  (Long Storm: 5 of 13); strikes with nobody left to take them are lost. Before, all eight landed on a lone target:
  casting nonstop (storms overlap, one every 1.5 s) that was about 1,150 power a second on a boss, 2.6× Zonde's
  ~440 and 1.7× Foie's ~680 with its burn, and about twice Zonde's damage per TP, while you were free to dodge. Now a
  boss takes 645 a cast, about Zonde's rate for 1.8× the TP; a pack of three or more still takes the whole storm.
  Considered and left out: bosses taking 75% less from area damage (it would also gut Hunter and Ranger area Arts
  such as Charged Shot and miss lone champions), and one storm at a time (the user: it ruins room clearing).
- **Aiming techniques** (2026-10-16, the user's ask): the area techniques that go somewhere (Gibarta, Gizonde,
  Rafoie, Razonde) go where the camera looks, not where she faces: Gibarta and Gizonde straight along the camera,
  Rafoie and Razonde onto the nearest enemy within 20° of its line (else 8 m out along it). A lock still wins. She
  turns to face that way through the cast. The single-target ones (Foie, Zonde, Barta) still soft-aim as before, and
  Gifoie and Rabarta are around her. Later the same day the single-target ones and the bolt went to the camera too,
  and the camera's target replaced the lock (see "Controls").
- **Modifiers**: every Art has two rows of three, one pick per row, opening at the Art's level +10 and +25 (90 at
  most). They change numbers (Long Spin: two more sweeps for +40% TP; Quick Guard: 6 s cooldown), add effects
  (Burning Blade, Vortex, Marking) or change the shape (Twin Crescent, Boomerang). Since 2026-10-15 every modifier is a
  node forking below its Art in the Skills trees (see "Skills"); the Arts tab only shows the ones taken.
- **Technique visuals** (2026-10-15, `world/spellFx.ts`; the user found Rabarta "like a stroboscope" and asked for
  every spell to match its fix): soft and steady, never a full-area flash on a rhythm. Particles (embers, sparks,
  snow, motes), ground marks that fade (scorch, frost, a soft glow), thin jagged lightning and ice crystals growing
  out of the floor replace the additive rings, solid telegraph-style fills and 10 m light columns. Fire: Foie is a
  hot core in an orange glow shedding embers, bursting with a scorch; Gifoie a ring of flame rolling out; Rafoie a
  meteor falling in from beyond the spot onto a glowing landing mark. Lightning: Zonde strikes from above, then
  arcs enemy to enemy; Gizonde races out along the floor; Razonde's strikes fall on subtly charged ground (`StaticField`, 2026-10-16: the user found the glowing disc
  too loud and asked for something subtler and more electric): a faint cloud shadow, a thin jagged rim with pulses of
  current running round it (so the area still reads), cracks of current flickering over the floor, the odd arc
  jumping off it, and a few cracks spreading out from each strike.
  Ice: Barta and Gibarta grow crystals (Gibarta row by row across the cone); Rabarta is a swirling snowstorm over
  frost that blows out at the freeze. Supports: motes rising over a glow at her feet. Burning and frozen ground
  (any Art's) are scorch or frost with embers or glitter rising. Hits that repeat on a rhythm (Rabarta's pulses,
  Razonde's strikes) skip the hitstop and the enemy's white hit flash (`TechHit.tick`). The photon bolt is a white
  core in the weapon's colour with a trail of motes, and the Arc passive's chain jumps enemy to enemy.
- **Balance** (analytic, `damageBreakdown`, on-tier plain weapon, one target). "New" is the best Art used whenever
  the basic chain has won its TP back, the Damage tab's per-second figure for an Art; "old" is the best light /
  heavy combo, and for Forces heavy Zonde cast back to back with TP left out (the old Force ran dry):

  | | Lv 10 old / new | Lv 95 old / new |
  |---|---|---|
  | Saber | 405 / 435 | 3,784 / 4,101 |
  | Sword | 361 / 299 | 3,655 / 3,837 |
  | Dagger | 503 / 431 | 4,405 / 4,319 |
  | Handgun | 407 / 419 | 3,934 / 4,072 |
  | Rifle | 255 / 282 | 2,615 / 2,930 |
  | Shot | 225 / 179 | 2,204 / 2,418 |
  | Rod | 492 / 453 | 3,575 / 3,329 |
  | Wand | 425 / 471 | 2,918 / 3,330 |

  Area Arts (Cyclone, Scatter Blast, the Gi- and Ra- techniques) are worth more on packs than this shows. Tuned on
  the way: Rising Edge 3.2 → 2.5, Charged Shot 3.5 → 2.6, Slug 4 → 1.9, Cyclone 0.75 → 0.5 a sweep (22 → 24% TP),
  dagger Arts up (Blade Dance 0.65 → 1.3, Venom Edge 0.6 → 1.05, Shadow Step 1.5 → 2.4), techniques ×1.54 power
  for half the TP (Foie 20 → 10), caster refill Rod 1 → 1.5, Wand 1.5 → 2.2.
- **Bot check** (`.claude/simsetup.js`, never dodges): Hell Forest Lv 84 tier 11, old → new: saber 271 → 240 s,
  handgun 214 → 181, sword 246 → ~170, dagger 297 → 251; a rod Force 208 s (Arts first). Normal: the Hunter is
  unchanged (Forest 71 / 120 s, Caves 127 s), the Ranger ~25% quicker (the old bot's light, light, heavy wasn't its
  best combo).
- **Old saves**: talents, the palette and the selected technique are dropped and bars start from the defaults; a
  picked photon blast is kept (on the Mag); the foie / zonde / barta affixes are renamed fire / lightning / ice.
- **Debug panel**: Basic attack folder (`basicAttack`); the weapon kinds' `tpRefill` / `boltPower`.
- Not done: Art and modifier numbers are a first pass; the bot can't judge control, defence or movement Arts.

## Classes (until 2026-10-21), the Mag and passives
The classes went on 2026-10-21 (see "One character: no classes"); the Mag and passive notes below still hold, with
two Mag tracks and the Force's passives. Agreed and built 2026-10-08, replacing the classless build (attribute points + the 112-square Mag grid) from the
day before. The user found the grid useless: keystones needed attribute points as well as squares, so squares spent
on an arm whose attribute you hadn't invested in led nowhere, and two systems both asked "what are you?". Their
calls: **three classes**, no Guardian (defence is something every class has); **Mists of Pandaria style talent
rows**, unique per class and **weapon-family specific**; **talents swap freely in Pioneer 2**; gear gated by **stat
requirements only** (levels only since 2026-10-14); **behaviour lives in talents only** (no item changes how you play; the exception since
2026-10-12 is the six uniques, see "Uniques"). Talents became Arts and passives on 2026-10-14 (see "Arts").
Old saves were deleted (key `pso-like-save-v3`, save version 5), no migration.
- **Classes** (`CLASSES` in `data/stats.ts`), fixed at creation: **Hunter** (melee: dagger, saber, sword;
  Saber + Mate), **Ranger** (ranged: handgun, rifle, shot; Handgun + Mate), **Force** (caster: rod and wand swings and
  **every technique**; Wand + Fluid). (Twelve kinds until 2026-10-14: see "Eight kinds".) Each grows like the old
  class did (Hunter HP 14 / ATP 4 / DFP 3 a level, Ranger LCK (was ATA) 1.8 / ATP 3.4, Force MST 4 / TP 6...), so gear
  requirements and the tuning below still hold. Hunters and Rangers know Resta (Shifta and Deband went on 2026-10-15); the nine attack
  techniques are the Force's (since 2026-10-14; everyone knew all six before). The class names
  the character; its Mag stat (POW / DEX / MIND) picks the outfit before a frame does and the Mag's first form.
- **Level cap 100** (`MAX_LEVEL`; was 130). Past it XP stops counting and the chase is gear (no paragon levels).
- **The Mag** (`game/mag.ts`): **one point per character level** into **POW / DEX / MIND / DEF**, like PSO's Mag levels
  without the feeding. Each point gives its main stat (the old squares' values) plus a secondary every class can use
  (2026-10-08, the user's pick after asking what POW / DEX were for on a Force): POW +3 ATP +3 HP, DEX +2.5 ATP
  +2 LCK (since 2026-10-09; was +2 ATA +2 EVP +0.5 LCK), MIND +3 MST +2 TP, DEF +2 DFP +4 HP (`MAG_BONUS`). **Permanent**: the
  Mag is the long-term build, Arts and skills the flexible part. Mag bonuses counted toward equip requirements, which is how a
  hybrid happened (requirements are levels since 2026-10-14; the tracks are named by what they give, see "Stats:
  named by what they do"). The Mag tab lists the four tracks with +1 / +5 and what the next point adds to damage. Evolution as
  before: stage 1 at Mag level 5 by the class's stat, 15 and 25 by the stat with the most points, the twin pair
  (Ashvinau) at 40.
- **Passives** (2026-10-14, `game/passives.ts`, numbers in `passiveCfg`, live in the tuning panel; the user's call when
  the Arts came in: "remove talents completely, they become passives"). The old talents, each **learned** at its
  old row's level. Until 2026-10-15 they went into **four slots** (Lv 5, 20, 46, 76); since then they are ranked
  nodes of the **Skills trees** (see "Skills"; the table below is still the level each one opens at). Weapon passives still need their family (or, for the Weight ones, their blade) in hand.

  | Learned at | Hunter | Ranger | Force |
  |---|---|---|---|
  | 5 | Follow-through · Parry · Tempo | Hot Streak · Breathing Room · Tempo | Resonance · Calm Mind · Tempo |
  | 12 | Lunge · Fleet · Slipstream | Backstep Shot · Fleet · Light Feet | Blink · Fleet · Slipstream |
  | 20 | Cleave · Sweep Guard · Shockwave | Spread · Suppress · Pierce | Overcast · Barrier · Purify |
  | 28 | Retaliate · Steadfast · Last Stand | Adrenaline · Bulwark · Last Stand | Focus Bolt · Ward · Conductor |
  | 36 | Crush (sword) · Balance (saber) · Flurry (dagger) | Deadeye · Point Blank · Longshot | Kindle · Frostbite · Longshot |
  | 46 | Bloodlust · Second Wind · Focus | Bloodlust · Field Medic · Focus | Efficiency · Clarity · Siphon Staff |
  | 56 | Executioner · Iron Finish · Whirl | Piercing Round · Pin · Arc | Overload · Aegis · Echo |
  | 66 | Breaker · Daunt · Shatter | Pinning Fire · Rounds | |
  | 76 | Fervor · Composure · Rush | Rapid Fire · Composure · Rush | Swift Cast · Composure · Rush |

  - **Gone with the talents**: Mark (the Rifle's Art now), Zonde Storm, Barta Field and Foie Split (the Gi- and Ra-
    techniques and the technique modifiers do their jobs), and the photon blast row (below). Talent picks in old
    saves are dropped (pick passives again); the photon blast pick is kept.
  - Every old Mag passive kept its effect (Rhythm split into Tempo and Light Feet's run speed). The staff technique
    mods and the Arc Welder's jumping shots became talents in 2026-10-08 under the "no behaviour on items" rule, and
    passives now. Descriptions with live numbers are `PASSIVES[id].desc()`.
  - "Perfect finisher" = the 3rd step of a chain chained perfectly twice (the ×1.4 one). Composure and Rush trigger on it.
- **Skills** (2026-10-15, `game/skills.ts`, numbers in `skillCfg`, live in the tuning panel's Skills folder). Built twice
  that day. First a Diablo 4-style tree (a column per branch, modifier rows and passives as nodes at a point each, Arts
  free); the user found it a mess ("a spell, then its Row 1 / Row 2 options, then the picked skill below it", empty
  cells, too many columns) and asked for **Diablo 2**: "put points into Foie to unlock Gifoie, and into Gifoie to unlock
  Rafoie". Picked from an interactive mockup: ranks (Arts 1-10, passives 1-5), modifiers at rank milestones, four trees.
  Later the same day the user asked for the modifiers to be part of the tree too (they sat in the Art's details), for
  Force's Support tree to go (its nodes spread over the other trees), and for Shifta and Deband to go from the game.
  - **Trees, one on screen at a time** (`skills.ts` lays them out): lanes of Arts on the left, each Art over its
    **modifier fork** (two rows of three) on a faint panel, the next Art of the lane below that; passives in up to
    three columns on the right, beside or below what they hang from. Every node is the **same square icon** (the user,
    2026-10-15: "instead of text put an icon on each node"): Arts their own glyph, passives a symbol in their role's
    colour, modifiers a symbol in their Art's colour (`ui/skillIcons.ts`; the three of a row always differ). Names show
    on hover and in the details pane, which leads with the icon large. Lines run at right angles: an Art spine down
    each lane's left side, org-chart forks under each Art, Art-to-passive lines out of the Art's right side and down
    a gutter, passive chains straight down; placement keeps every line off other nodes (a test checks it). Lit lines
    (gold) lead to skills with points; the rank sits in a corner badge, gold at the top rank. Three looks (the user's
    calls, 2026-10-15/16): **learned** (frame, fill and glow in its colour), **in reach** (its colour as the frame
    only, the icon grey until a point goes in: points could get it at this level, even if it first needs ranks in what it hangs from or a sibling modifier
    swapped out; `skillReachable`), **out of reach** (the whole square faded far back: a level stands in the way, there
    or up its chain). The tree keeps its scroll while you click about in it (`data-scroll` on a menu element keeps its scroll
    across re-renders while its value stays the same). Hunter Sword · Saber · Dagger · Combat (Leap → War Cry → Iron Will, and a Resta
    lane, with the general passives); Ranger Handgun · Rifle · Shot · Gunnery (Freeze Trap → Backflip Shot → Grenade,
    and Resta); Force Fire · Lightning · Ice (Resta's lane sits in Ice, with Barrier / Purify / Composure; Calm Mind,
    Siphon Staff and Clarity in Lightning; Efficiency in Fire). Chains: Foie → Gifoie → Rafoie, Cyclone → Ground
    Breaker → Sunder, and so on; passives hang from the Art or passive they fit (Kindle from Overcast from Foie).
  - **Points**: one a level (100 at Lv 100). A node needs its level and a point in the one it hangs from.
  - **Arts cost points now**: rank 1 learns one (a new character's Lv 1 point goes into its start weapon's first Art,
    or Foie). Each rank after adds power (rank 1 ×0.85, +6% of that a rank: rank 4 ≈ the power before ranks, rank 10
    ×1.31) and takes 2% off its TP. Power is damage, and Resta's healing.
    Unlearned Arts can't go on a bar (the Arts tab lists them as "Not learned yet"); learning one drops it into a
    changed bar's first empty slot, and an Art taken back to rank 0 leaves every bar. Level-ups no longer fill bars;
    they toast the points and the Arts that can now be learned.
  - **Modifiers** are nodes forking below their Art, a point each, **one per row**: the first row needs the Art at
    **rank 5**, the second at **rank 10** and a first-row pick. Taking one darkens the other two of its row (the branch
    not followed), and the second row's line comes from the first-row pick. Nothing comes back while something rests on
    it: the Art can't drop below a milestone with a pick on it, nor a first-row pick go with a second-row one taken. The
    Skills badge counts unspent points while something can take one.
  - **Passives** take up to five ranks, the fifth being the old full effect: a multiplier moves from 1 toward its
    value (`rankMult`), an amount from 0 (`rankAmt`); times, ranges and counts don't scale. Twenty on/off ones (Fleet,
    Blink, Lunge, Whirl, Pierce...) take one rank. Descriptions show the numbers at the current and next rank.
    Code asks `Character.pMult(id, full)` / `pAmt(id, full)` (1 / 0 without it, or with the wrong weapon).
  - **Respec**: free out of a fight, one rank at a time (+1 / Max / −1 in the details); the last rank of a node can't
    go while something hanging from it has points.
  - **Old saves** (the passive slots, or the first tree): the Arts on their bars learn rank 1 (with what they hang
    from), then their old passives rank 1, while points allow; the rest is left to spend.
  - **Balance not measured**: no passive cap any more (100 points buy many passives at full rank), and Arts at rank 10
    hit ~31% harder than before ranks. The bot sims grant every Art at rank 4 (simsetup `mkChar`), so they still
    compare with the old numbers; a real pass needs typical builds per band.
- **Photon blasts** (on the Mag since 2026-10-14; the Lv 85 talent row before): from **Lv 85** the Mag tab offers
  three, one picked at a time. A gauge (gold tab on the HP / TP frame's top-left edge) fills from your damage (0.04
  per normal enemy's bar, elites double, a boss's whole bar 0.6; halved 2026-10-11 at the user's call, was 0.08 /
  1.2); it **fires by itself** when full (2026-10-11; it was key 2), in a fight (a sealed room or an engaged boss)
  and when you can act. **Mylla & Youlla**: 5× your basic finisher (or photon bolt) to every enemy within 10 m; it
  waits for an enemy in reach. **Leilla**: heal 30% and take half damage for 4 s. **Farlla**: weapon damage +35% and
  damage taken −14% for 60 s (it cast Shifta and Deband until those went). Numbers in `magCfg` (pb*).
- Not done: every passive and Art number is a first draft; most can only be judged by playing (the bot never
  dodges or uses dashes).
- **Debug panel**: Passives folder (every `passiveCfg` number), Basic attack folder, Mag photon blast sliders,
  "give random unit", "+10M EXP".

## Loot & Progression — PSO-style
- XP curve + level-ups: stats come from the character's growth (`GROWTH`, see "One character: no classes").
- **Affix loot** (Diablo 2 / Path of Exile style, built 2026-10-08, `data/itemAffixes.ts`, rolled in `loot.ts`): the
  user's ask, so loot doesn't feel bad with classes. Rarity:

  | Rarity | Name colour | Affixes | Frame unit slots |
  |---|---|---|---|
  | Normal | white | none | 0-1 |
  | Magic | blue | 2 (one prefix, one suffix) | 1-2 |
  | Rare | yellow | 4 active + 1 dormant on Normal tiers (1-7), 5 + 2 on Nightmare (8-11), 6 + 3 on Hell (12-15) and in rifts; at most 3 of each active | 2-3 |
  | Unique | purple | none: one effect and one cost of its own (see "Uniques") | 2 (frames) |

  Field drops roll 40% normal / 47% magic / 13% rare (elites 2.5× the rares); boss gear is at least magic, the
  Nightmare top weapon and all Hell boss gear rare. Shops sell white and blue only.
  - **Prefixes** are offence plus flat HP and TP, so survivability competes with damage for the same 3 slots;
    **suffixes** are defence, utility and resistances. A weapon's rolled special (Heat, Ice, Shock, Draw,
    Dim, Venom) counts as a prefix. No affix twice. Counts are fixed (2026-10-13, the
    user's redesign; they were ranges) and rares hold **dormant** affixes too (see "Crafting: Photons"). Draw
    weights: 1 a normal affix, 1.2 a weapon special, 0.5 a downside. (Race % drew at 0.5 too, 1.5 before
    2026-10-13, until it went with enemy races on 2026-10-17; see "No enemy races".)
  - **Item level** = the band the item's tier drops in (T1 1 ... T7 37, T11 77, T15 98); it decides the best of six
    strength tiers an affix can roll (tier 1 from iLvl 1, 10, 22, 36, 55, 80), usually the top one, sometimes one or
    two below. Haste (and Frail) only from tier 8, 1% up to
    `hasteCfg.capByTier`.
  - Pools (numbers only): every weapon ATP %, flat ATP, LCK (crit), Haste, TP refill % (Flow) and injector charge;
    melee stagger % and
    finisher damage; guns damage falloff distance and perfect-shot damage; staves technique damage,
    flat MST, Foie / Zonde / Barta damage, TP cost and TP regen (1-2 TP/s, in fights too: a fighting
    chance once the injector is dry; it was +TP per staff hit until 2026-10-10). Cast speed (casts only, caster
    weapons) was folded into Haste on 2026-10-11 at the user's call: saved rolls became Haste, capped by the item
    tier's Haste top, and were dropped below tier 8. Frames, barriers and units: flat
    HP / TP / DFP, LCK, HP regen (in fights too since 2026-10-09: 1-5 HP/s, was 1-10 between fights only), injector potency and charge, run speed, dash recharge, poison /
    paralysis / Burn / Corruption resistance; barriers also area / boss / hazard damage and knockback ("Stability").
    (The unique-only hazard and pylon affixes went with the old uniques, 2026-10-12.)
  - **Downside affixes** (rares and units): Overcharged (+TP, −HP), Brittle (+technique damage, −DFP), Frail
    (+Haste, −HP): the glass-cannon dial. (Reckless, +weapon damage %, went on 2026-10-21 with the melee and gun
    affixes and the weapon specials.)
  - **Caps**: run speed +20% from gear and passives together; each status resistance 75% (no immunities: the user
    dropped them).
  - **Units** (PSO's): one affix each, `unit_1`-`unit_15` by tier, dropped (about 1 in 25 drops, one per boss, two
    on Hell). **Units are learned, not carried** (the user's ask, 2026-10-10: unit drops kept filling the bag).
    Picking up a unit of a kind (its affix) you don't know learns it for good; a better roll of a known kind (bigger
    value, or the same value with a smaller penalty) replaces the learned one, which is gone. Learning needs no bag
    slot. A unit no better than the learned one goes to the bag as junk: worth its price, nothing else ("Sell all
    junk" takes it). Learnable units are walk-over pickups (2026-10-12, the user's ask), like meseta and photons;
    junk ones stay on the ground until picked up by hand. On the ground only learnable units get the pillar and a green ▲; the rest fade grey like junk
    gear. `data.units` is the learned collection (one per kind, "N of 21 kinds" on the Mag tab), `data.magUnits` the
    kinds slotted in the Mag (up to 4, in priority order; the 2026-10-08 idea, after moving units between frames felt
    like a chore). The **equipped frame's unit slots decide how many are active**: the first N in the order (▲ ▼ to
    reorder; Remove only unslots, the unit stays learned). Swapping frames needs no unit handling: a frame with fewer
    slots switches the rest off, with a toast and an orange ! on the Mag tab (also shown when a slot is free and a
    learned unit isn't slotted). Frame cards show "Unit slots: N", and the frame verdict counts them (more slots, more
    active units). Old saves learn every unit they had (Mag and bag, the best of each kind) and keep the Mag's slots.
    Units are the deliberate part of a build: four TP units behind a 4-slot frame is a glass cannon on purpose.
    **Unique units** (2026-10-17, Rift Circles; `uunit_<id>`, see "Uniques") are learned the same way, a kind of
    their own each (`unitKind` is the unique's id), with an effect and a cost instead of an affix; as many as the
    frame's unit slots allow can run (unique frames have 2). A second copy is junk.
  - **Uniques**: the thirty from this pass were deleted on 2026-10-12 (see "Uniques").
  - **Hit %** is gone (accuracy was already capped). Grinders are unchanged (Edge or a race per level).
- **No enemy races** (2026-10-17, the user's call). From 2026-10-07 they followed the expeditions like PSO's: Forest
  (Boomas, Dragon) Native, Caves A.Beast (the lilies Native, De Rol Le Dark), Mines Machine, Ruins and Dark Falz
  Dark, and a weapon's race % affix (up to 80% at tier 15) multiplied its damage on that race. It made bosses a
  gear check: a rift ends at a random one of the four bosses, two of them Dark, so a Dark 80% weapon fought them as
  if five rift tiers lower (the ladder's HP ×1.12 a tier), and you only learned which at the teleporter. Gone with
  them: the four race % affixes (and their "of Beasts" names), the attribute tag under a target's and boss's name,
  the Damage tab's race picker, the card's per-race table and the Photons' race rules. The user's picks:
  - **Two weapon suffixes take race %'s place**, so a Hell melee or ranged rare draws its 3 suffixes from 5 (LCK,
    Haste, Stagger / Reach and these), not always the same 3: **TP refill** (`tpRefill`, "of Flow", every weapon:
    basic hits refill 3-20% more TP, counted in the Damage tab's sustained Art rates) and **Injector charge**
    (`injCharge`, now on weapons as well as frames).
  - **Pylon light and blasts hit every enemy**: the light slowed and exposed only Dark enemies, Garanz missiles and
    Volatile blasts hurt only machines. In their home areas that was everyone anyway; in a rift it was a hidden rule.
  - **No damage given back**: race % was a bonus on top (about +20% on average across a rift's mixed waves for a
    max-race weapon, +80% on a matching boss), and the rift numbers stay.
  - **Old saves:** race rolls are dropped on load (`readAffixes`: unknown ids) and `upgradeCrafting` tops the item
    back up to its counts with fresh rolls (seeded by its uid). The Mines' clank and spark sounds key on their AIs.
- **Item names** (`itemName`): magic items take a word from their prefix and their suffix (`Heat Brand of Luck`,
  `Heavy Buster`, `Guard Armor of Grace`); rares a rolled two-word name by what they are (`Doom Edge +2`, the base
  shown on the card); uniques their own name; injectors their mod (`Steady Star Fluid Injector`); units their
  affix's unit name (`Heart Unit`).
- **Item card** (`ui/itemCard.ts`, 2026-10-09, the user's ask: weapons and armour looked nothing alike, and the
  comparison repeated the card): one layout for every item, and the comparison folded into it. Header: name in its
  rarity colour, type line with item level, the requirement as a chip (red, with "you have N" on hover, when unmet).
  A **verdict line** ("▲ +7% overall, vs. Blood Shell"; weapons "damage / sec") for gear that isn't worn, "Equipped"
  for gear that is. **Stat tiles** (weapon ATP / MST, armour DFP and the line's bonus stats):
  flat affixes of a tile's stat fold in as a blue +N, and each tile shows its change against the equipped piece.
  **Affixes** (the rest): a green dot, or a red one for a downside affix (2026-10-09: per-role colours read red as "bad"), each tagged **new** or with its
  change; flat stats compare as totals, penalties included. **You'd lose**: what only the equipped piece has, struck
  through. **Chips**: special, unit slots as pips. Weapons end with their damage per second (cells show %
  against the equipped weapon). Flavour text only where
  an item has its own (uniques, units, consumables); the armour lines' repeated blurb is gone.
- **Verdicts**: all gear is judged by **damage per second** against the current expedition's average enemy (the
  selected technique for casters); armour falls back to its **rating** (its stats and affixes weighted for the
  class: HP, DFP, resistances, utility) only when the damage is the same (within 0.5%; the rating within half a
  point). Damage first for armour too since 2026-10-13 (the user's call, after a Force's HP / resistance frame read
  ▲ on the rating while it lowered their technique damage); the card shows the rating's change next to the damage.
  That number is the card's verdict line and decides ▲ / ▼ and junk.
- **Drops on the ground** (`world/Pickup.ts`): the gem's colour is the type; **magic** gets a blue halo, **rare** a
  yellow halo and pillar, **uniques** a purple cube and pillar, photons a cyan pillar, **units** a pale cyan gem and
  pillar while they're worth learning (a new kind or a better roll; otherwise junk-grey, no pillar).
  **Junk** (worse than what is worn, by the verdict above; uniques never) fades grey; an equippable upgrade gets a
  green ▲. The pickup note reads "Damage/s +12% · LCK +3" or "Needs ATP 90 (you have 76) · Damage/s +30%".
- **Every weapon drop is a rod or wand and every armour drop Psy** since 2026-10-21 (drops leaned 80% to the class
  before, `LOOT_LEAN`); injectors lean Fluid (35% Mate). Fewer gear drops than before (Diablo 3's Loot 2.0 rather than
  Diablo 2's volume): weapons 13, armour 9, units 4 out of 100 drop rolls.
- **Sell all junk** (shop, Sell tab): sells every bag item the verdict calls junk (uniques stay; units in the bag are
  always junk, since a learnable one is learned on pickup). **Salvage junk** next to it breaks the junk magic and
  rare gear into Photon Drops instead (see "Crafting: Photons").
- **Supply boxes** open with the interact key (R, when within reach; the context hex shows a crate) and
  drop an item or Meseta. Attacks and techniques pass them by, so area attacks never waste hits on them.
- **Grind: built in** (2026-10-11, the user's call). **Grinders are gone**: every weapon, frame and barrier counts as
  fully ground (`grindLevels` in character.ts), so a drop compares on equal terms the moment it lands. Why: grinding
  had no choice left in it once race (Bane) levels went with crafting ("feed your best item"), and the rift loot
  analysis found a fresh drop starting 10-12 levels (about +33% damage) behind a ground piece. Their picks: full max
  grind on everything (not half), and the grinders' drop share went to photons.
  - **Levels** (`grindCap`): 5 at tiers 1-2, 6 at 3-4, 7 at 5-6 ... 12 at tier 15; uniques 2 more. Frames and
    barriers the same.
  - **Weapons (Edge)**: +4% of the weapon's own average ATP (both ends) and +15% of its MST on rods and wands
    per level (`formulas.edgeAtpPct / edgeMstPct`): +48% ATP and +180% MST at tier 15.
  - **Frames and barriers**: +5% of their own DFP and stat bonuses per level (`formulas.refineArmorPct`, applied in
    `statDef` with Rift-forging): +25% at tiers 1-2, +60% at tier 15.
  - Item names lost the "+N"; the card's Grind tile and the grind picker went; shops and prices have no grind premium.
  - **Supply:** the drop table's grinder share (8) went to photons (4 -> 12); bosses' grinders became photons of the
    boss's tier (Normal tiers only make Photon Drops). Pre-ground drops are gone.
  - **Old saves:** grinders leave the bag (unknown items are dropped on load); saved grind and Bane levels are dropped.
  - (History: 2026-10-07 grinding became Edge or a race per level, caps 5-9; 2026-10-11 races went and armour took
    levels too, then the same day grinders went entirely.)
- Requirements to equip are **the character's level** (the item's item level) since 2026-10-14; they checked base +
  Mag stats before.
- **Armor lines** (every line of a tier opens at its level since 2026-10-14; the history below is the stat-gated one),
  gated like weapon kinds by a stat requirement alone (no classes since 2026-10-08): a neutral
  tier-1 starter, then **Guard** (req ATP: most DFP, small ATP), **Combat** (req LCK since 2026-10-09: light DFP,
  biggest ATP, plus LCK) and **Psy** (req MST: low DFP, adds MST + TP), tiers 1-4. Requirements equal the line's stat
  for the class that wears it at levels 6 / 12 / 20, so wearing another class's line needs Mag points in its stat.
  Balance was checked with the combat bot (Forest, Lv 12, tier 3): Hunter Guard is safer and Combat ~6% faster;
  Ranger Combat beats Guard on both kill time and damage taken; a casting Force clears ~12% faster in Psy.
- **Mag**: see "Classes, the Mag and passives". It floats behind the player's shoulder and stands beside her on the
  character select pad; its pod glows in her accent colour while a Mag point or a skill point is waiting.
- Currency: **Meseta**. No consumables are left: the Telepipe and charge orbs went on 2026-10-11 (see "Telepipe" and
  Injectors).

## Injectors — HP / TP sustain
Agreed 2026-10-07, replacing stacks of mates and fluids. Stocking up on consumables made content trivial, while a
player deep in an expedition without them had no way back up; and the consumables crowded the 30-slot bag.
- **One equipment slot** (key 1, also assignable to Q / E) takes a **Mate** (HP) or a **Fluid** (TP) injector.
  Everyone starts with a Fluid (Resta turns TP into HP; Hunters and Rangers started with a Mate until 2026-10-21);
  the mods are the real choice.
  (2026-10-07: it was two slots with generous recharge, and a player who didn't outlevel the content still never
  emptied the second one: a single Mate gave ~19 doses a floor against the 2-5 a dodging player needs.)
- Every injector holds **3 doses**; tiers differ in how much a dose restores: Mate 35 / 35 / 36 / 39 / 42 / 47% of
  max HP, Fluid 35 / 35 / 35 / 35 / 36 / 38% of max TP (TP pools grow faster than HP, and Resta turns TP into HP).
  2026-10-09, the user's ask: every tier restores at least 35%, as the starting 30% ran dry early on, while from the
  Caves on it felt right (Fluid tiers 3-4 rose from 32-33% to keep the order). There is
  no shared cooldown; a dose locks the hands for 0.45 s, and a hit cancels the lock, not the dose.
  (2026-10-07 nerf: a Lv 26 MST Force never ran dry with 5 × 50% Fluid doses that refunded ~40 TP per kill.)
- **Recharge comes from damage dealt**, not kills: the injector gains doses in proportion to the enemy HP the
  player removes (a normal enemy's whole bar = 0.15 doses; elites ×2; **Fluid injectors charge at half that rate**
  from every source). Bosses count the same way across their whole bar (Dragon 3 doses, De Rol Le 4.5, Warden 4.5,
  Dark Falz 5).
  Lava damage and re-formed Pan Arms halves give nothing. Only Pioneer 2 refills everything at once (no field
  refills since checkpoints went). A floor (~35 enemies) is worth about 3 + 5 Mate doses.
- **Out of combat** (2026-10-08, the user: "very rough at lower levels at least"): with no room fight and no boss
  engaged, the injector **refills completely**, every debuff (Corruption, poison, Burn, paralysis) is cleared, and
  **HP and TP** refill (since 2026-10-11, the user's call: topping up
  by hand after every fight was a chore), once **3 s** have passed since the fight (`injectorCfg.calmDelay`,
  tuning panel **Injectors**; "INJECTOR REFILLED" floats up). Since 2026-10-09: it used to trickle back at 0.1 doses a
  second, which the user called degenerate (you could always just stand and wait). Within a fight only the
  damage-based charge and orbs refill it, so Absorbent, injector-charge affixes and Bloodlust matter there. This reverses the earlier "nothing refills between
  fights" rule (and the one-dose trickle before that); the damage-based charge and orbs still decide mid-fight.
  (Recharge was 0.1 / enemy for a few hours on 2026-10-07; the user found it far too slow, so all damage-based
  sources went up by half.)
- **Requirements** only on tiers 3-5: Mate needs DFP 45 / 70 / 95, Fluid MST 80 / 115 / 150 (base + Mag, like
  gear). A MIND build can't run a strong Mate without DEF points or squares; a fighter can't run a strong Fluid.
- **Mods** (one per injector, about half of drops, two in every item shop): **Steady** (over 4 s, +60%),
  **Emergency** (+60% when the gauge is under 35%), **Reserve** (holds 4 doses instead of 3), **Absorbent** (charges 50%
  faster), **Sol** (also cures poison, paralysis and Burn, 4 s paralysis ward, usable while paralysed), **Bracing** (30%
  less damage for 3 s). Swapping injectors for a boss or a poison-heavy floor is the point.
- **Charge orbs: removed** (2026-10-11, the user's call). From 2026-10-07 to 10-11 elites, champions and some
  enemies and crates dropped a walk-over orb worth one injector dose. With the injector (and HP / TP) refilling
  completely 3 s after every fight, mid-fight damage-based charge is the only refill in a fight now.
- Shops sell tier 1 and the two best tiers on sale (clean), plus two modded ones. Injectors drop as their own
  loot category; healing left the drop table, so gear drops a little more often.
- The HUD shows the injector beside the gauges: one cell per dose, the next one filling as you fight.

## Telepipe (removed)
- **Removed on 2026-10-11** (the user's call), with the long "channel" cast that only it used. Saved Telepipes leave
  the bag on load and quick slots that held one are emptied; the class palettes' slot went to Resta (Hunter, Ranger)
  or stays empty (Force). Pioneer 2 is reached through the floors' teleporters, a cleared boss arena's, a rift's
  Guardian room, or by dying. (It was a 3.5 s breakable cast opening a two-way portal between the field and the city.)

## Death & Saves — PSO-like
- Death costs no Meseta. The only option is returning to Pioneer 2 (no Moon Atomizer or Scape Doll): come back
  through the city teleporter.
- **Floors are the checkpoints** (2026-10-07, their design; checkpoint pads removed). Each expedition keeps its own
  run this session (`Game.runs`): the furthest floor reached, boss arena included, and the rooms cleared on each
  floor. The city teleporter has one row per expedition with a progress tag ("2/3 · Cave 2") and takes you to that
  floor's start; cleared rooms stay cleared. Their calls: progress lives for the session only (not saved, like PSO;
  logging out starts every expedition fresh), several expeditions can hold progress at once, there is **no field
  refill** (only Pioneer 2), and **no manual reset**: only killing the boss completes the run, after which the row
  starts again at floor 1. Cave 2 and Mine 2 have a teleporter to Pioneer 2 where their checkpoint pads were.

## Level Design — Forest 1
- Handcrafted **room graph** defined in data, with rooms connected by corridors.
- **Laser-fence gates** lock rooms until the enemy waves are cleared.
- One or two switch/key puzzles. The layout is the same every run.

## Enemies (first playable)
- **Booma family:** Booma → Gobooma → Gigobooma (stat/behaviour tiers).
  Melee brawlers with slow, clearly telegraphed swipes. Wave composition varies the mix.
- **Boss — Dragon-style:** arena fight with phases: ground stomps, fire-breath cone, burrow phase,
  head/belly weak point. The eruption out of the burrow is the game's first **dash check** (see Dash checks);
  enraged stomps hit 7 m instead of 6. Below 40% HP (enraged) the breath turns after you while it fires, at
  `enragedBreathTurn` 0.35 rad/s (~36° over the 1.8 s breath; 2026-10-17, the user: was 0.7, "very hard to dodge").
  A walk out of the cone started in the windup keeps ahead of it to ~13 m. A Hell triple's breath holds its aim.

## Hub
- **Shops:** weapon, armor, item. Buy/sell, with partly random stock that scales with level.
- (Deferred: bank, tekker, guild quests.)

### Pioneer 2 look (2026-10-08 redesign)
- The user's calls: **faithful PSO1** (white deck panels, PSO blue bands, gold trim, cyan light strips, a view of
  Ragol), **two areas** joined by a short walk, **visual only** (the same facilities as before), with a **window onto
  Ragol** and an **ambient crowd**.
- Layout (`areas.city`): the **shop plaza** (Weapons / Armor / Items on the north wall, Stylist west, Medical east,
  a holo-globe fountain in the middle) → the **promenade** (arches signed "Ragol Transporter" / "Shopping District",
  chevrons on the floor) → the **teleporter deck**. You arrive on the deck in front of the transporter gate, facing
  the plaza. The deck's south wall is a **window** (`RoomDef.window`): solid, drawn as a sill, mullions and glass;
  beyond it the ship's hull falls away over **Ragol** (a procedural planet with continents, ice caps and drifting
  clouds), with shuttles crossing. Colony towers stand beyond the other walls, never in front of the window.
- Every counter is a **booth**: side walls with a light strip in the shop colour, a canopy with a lit sign, a floor
  mat, and the wares on the back wall (sabers and handguns, armour frames, capsule shelves, a lit cross, colour
  swatches). Booths, signs and dressing live in `world/CityScenery.ts`; counters and NPCs stay in `Interactable`.
- **Crowd** (`world/Crowd.ts`): ~17 passers-by (civilians, and other hunters in PSO section-ID colours), two of
  them chatting pairs. They stroll between free spots, cross the promenade, stop to browse at the counters, pause
  when the player stands in their way (then pick somewhere else), and are solid to the player. They use blob
  shadows instead of cast shadows (each is ~50 meshes; shadow passes would double that).

## Saving
- **Autosave** (character only: level, XP, items, Meseta, Art bars, skills, appearance, stats). The
  expedition itself is not saved, so loading always starts in Pioneer 2, as in PSO.
- Saves right after important events (entering Pioneer 2, closing a menu, shop trades, level up,
  rare drop, boss kill, appearance change), at most one every 2 s and never while the player is down;
  every 60 s of field play; and when the page is hidden or closed.
- Menu feedback (errors, purchases, Mag learning) shows as toasts, never inside the window: top-centre in play,
  bottom edge while a menu is open, so the window layout never shifts. A "Saved" blip shows in the top-right
  corner and the pause window shows when the last save happened.

## Graphics
- **Procedural low-poly models built in code** (no external assets), styled after the PSO originals:
  the player heroine, Pioneer 2 shopkeepers, the Booma family, the Dragon, forest props and weapons.
- **Player character:** one anime-styled heroine for everyone (`models/heroine.ts`), assembled from
  interchangeable proportions, hair, outfit, accessory and colour scheme (`PLAYER_LOOK`). Long hair and
  skirt/coat panels have spring-driven secondary motion and are pushed clear of the legs each frame.
  Sci-fi gear is part of the look (she stays human): glow trim / circuitry, light to heavy armour,
  tech headgear and back tech (shoulder pods, hover bits, halo, wing thrusters). Glow is cosmetic.
  Face gear (blindfold, visors, half mask, markings, goggles) is its own slot.
  Character creation is a customiser (`CREATION_CHOICES`): body proportions, hair (H1/H3/H4/H7), face gear
  (none/F3/F4/F6) and colour scheme, plus per-slot hair / outfit / trim / glow colours, with a live preview.
  No accessory. The chosen look is saved as `appearance`; the Character Lab keeps every option for design work.
  The **Stylist** in Pioneer 2 (west wall) reopens these steps any time, for free.
- **Armour looks** (2026-10-07, their call): the outfit, glow and back tech are no longer choices; the
  **equipped frame** decides them (`armorLook`, `playerLook`), like a Mag evolving. Since 2026-10-21 (one armour line)
  she always wears the robe (Halo); until then the frame's line picked the outfit (Guard = jacket, Combat = coat &
  knit, Psy = robe). Its tier picks an **evolution stage** (`TIER_STAGE`): T1 = 0,
  T2 = 1, T3-4 = 2, T5-7 = 3, T8-11 (Nightmare) = 4, T12-15 (Hell) = 5, so Normal tops out at stage 3 (the Ruins' T7 included). Each stage keeps the parts
  before it (`EVOLUTIONS`, whose descriptions are the reference): glow trim from stage 2, circuit lines from 3, a slow pulse at 4.
  - **Vanguard** (Guard): spiked pauldrons + bracers → warplate with a core, hip plates, plated coat tails →
    a floating crown of light blades, knee / shin plates, heel jets → a taller crown ring, a wheel of photon
    blades behind her back, two hex shields → **Imperator** (Hell): the wheel's hub becomes an eclipse ringed by
    an outer circle of lances turning the other way, and a two-part cape of light that bends back when she runs.
  - **Ember** (Combat): dark feathers over the shoulders → light-edged plumage, furnace core, feather tassets →
    small folded wings, ruff, talons → full wings shedding sparks and a feather wreath → **Phoenix** (Hell): a
    tail of five feathered plumes with glowing eyes, fanned standing and streaming out running; the core becomes an eclipse.
  - **Halo** (Psy): a halo ring → floating armlets → an orbit ring with crystals round the hips, halo rune
    plates → seraph wings of light and a mandala halo → **Archon** (Hell): six-feathered wings, an eclipse at the
    halo's heart, and floating pauldrons of three nested plates crowned with tall crystal spires (above her head).
    (Two great crossing rings were tried first and turned down: no more hoops.)
  - **Every Hell frame** (stage 5) also gets: **burning eyes** (the iris glows in the glow colour with a white
    core; wisps of light stream off the outer corners, trailing back as she runs), **glowing veins** down the
    outer forearms, outer thighs and the backs of the calves (the robe hides the legs) with a pulse of light
    climbing from the feet every couple of seconds, and **motes of light** spiralling up around her. The shared
    Hell motif is the **eclipse**: a dark disc with a lit rim and a breathing corona.
  Barriers don't change the look. Creation and the Stylist show an armour preview row (stages 0-5) on the
  Colours step so the glow colour can be judged. Previews: **`/armorlab.html`** (all three outfits, the robe the
  game's and Vanguard and Ember for reference, or one from the front and from behind; optional Mag to check
  clutter), sheets in `armor-previews/`.
- **Character Lab:** `/charlab.html` compares those variations side by side (idle, run, turntable).
  Flat shading, saturated colours, a few hundred to ~1.3k triangles per character.
- Animation is procedural: each rig eases toward poses, and attack poses are driven by combo time so
  the blow always lands on the gameplay hit frame.
- **Model viewer:** `/viewer.html` on the dev server, to inspect and pose any model, swap weapons,
  scrub animations and toggle wireframe without launching the game.
- Floating damage numbers, hit flash and simple hit-stop for combat feedback.
- **Area looks** (2026-10-07, `data/looks.ts`): the Caves and Mines were too dark and depressing. The Caves are now a
  **bioluminescent grotto** (glowing crystals, mushrooms and moss in the palette, glowing water, aurora and stars
  overhead) and the Mines a **neon megafactory** (glossy navy decks, neon wall strips and holo signs, a night sky
  with a ringed planet). Each area has three variants (Caves: Teal lagoon / Violet crystal / Emerald spores; Mines:
  Synthwave / Cyber teal / Vapor sunset), compared and picked in **`/arealab.html`** (picks live in this browser;
  "Copy LOOK_PICKS" bakes them into `looks.ts`). `world/Atmosphere.ts` adds the sky dome, coloured fog, sky
  reflections and bloom for areas that have a look; Forest, Dragon and De Rol Le are unchanged (Pioneer 2 has its
  own space sky, see Hub).

## Audio
Agreed 2026-10-05: everything **synthesized in code with the Web Audio API**, with no audio files (the same rule as the models).
- **Music: PSO-inspired original tunes**, written as note data (`audio/music/tracks.ts`) and played by a look-ahead
  step sequencer through FM / subtractive instruments. **Adaptive, as in PSO:** each field track has a *calm*
  and a *battle* arrangement over the same chords and tempo. Battle crossfades in on the beat when a room's gates
  seal and fades out when the room is cleared.
  Pioneer 2 (jazz-fusion, also the title screen), Forest, Caves. Boss arenas are silent until the boss wakes,
  then play its own theme (Dragon, De Rol Le, Warden, Dark Falz). The enraged / shattered / overclocked phase (the Angel for Dark Falz) brings in the boss
  theme's battle layer. After the kill, a victory fanfare plays, then the expedition's field theme.
  Mines, Warden, Ruins and Dark Falz play their synth arrangements until ElevenLabs recordings are made (credits ran out).
  The Caves battle loop (2026-10-09) is no ElevenLabs take (they kept coming out as synthwave): it is the synth
  arrangement `cavesBattle` (primal and urgent: taiko, hand drums, a drone, a low chant, a wooden flute at 126 BPM)
  rendered offline by `audio/music/render.ts` into `public/music/caves-battle.mp3`.
- **SFX: about 90 sounds in four groups** (combat, enemies & bosses, world & loot, UI), plus jingles (level up,
  room clear, victory, death, Mag evolution). World sounds are panned and attenuated relative to the player and
  camera. Footsteps follow the run cycle and the area surface (metal deck, grass, stone, wooden raft). Caves
  have a bigger reverb. The pause screen muffles the music; menus don't (PSO kept playing under them).
- **No volume or mute UI** (by request). The lil-gui tuning panel has master / music / sfx sliders for development.
- **Sound Lab:** `/soundlab.html` lists every sound with 2-3 labelled variants to audition, and every track with
  a calm / battle toggle. Picks are saved in the browser and the game uses them live; "Copy SOUND_PICKS" gives
  the code to bake into `audio/picks.ts`. "Measure loudness" renders every variant offline and prints
  `LEVEL_TRIM` for `audio/levels.ts`, so each variant lands on its loudness target (`LEVEL_TARGET`).

## Implementation map (first playable)
- `src/game/combo.ts`: 3-step chain state machine, basic steps and Arts (unit-tested).
- `src/game/data/`: stats and the character's base and growth (`stats.ts`), item affixes (`itemAffixes.ts`), items (weapon kinds × tiers, rares, armor, injectors, consumables,
  grinders), techniques (MST scaling), area layouts.
- `src/game/character.ts`: persistent character, inventory, equipment rules, grinding, technique cost / damage, XP.
- `src/game/mag.ts`: Mag tracks, points, evolution forms and the photon blasts; `models/mag.ts` is its model.
- `src/game/injectors.ts`: injector stats, mods, charge and doses (unit-tested in `injectors.test.ts`).
- `src/game/loot.ts`: drop tables, rarity and affix rolls, units, injector rolls, shop stock.
- `src/game/passives.ts`: passive definitions, their weapon requirements and descriptions (numbers in `config/` `passiveCfg`).
- `src/game/skills.ts`: the Skills trees (layout, prerequisites, ranks, modifier forks, points, save repair and migration; numbers in `skillCfg`).
- `src/game/data/arts.ts`: every Art (the techniques) with its modifiers; `src/game/combat/arts.ts` (`ArtRunner`)
  carries them out, `combat/Combat.ts` runs the basic chain (photon bolts), Art costs, debuffs (Static's mark,
  venom, chill) and ground zones.
- `src/game/world/`: level builder (rooms + corridors + laser gates; forest, lair, cave and river dressing),
  room waves (pinned spawns, ambushes, overlap), Pan Arms pairs, hazards, cosmetic effects, pickups, boxes,
  projectiles, telegraphs, interactables.
- `src/game/enemies/`: `Enemy` base + `Brawler` (Booma family), cave AIs (`caveEnemies.ts`), Mines machines
  (`mineEnemies.ts`), Ruins enemies (`ruinsEnemies.ts`), factory (`spawn.ts`), the `Boss` interface, Dragon
  (`Dragon.ts`), De Rol Le (`DeRolLe.ts`), the Warden (`Warden.ts`) and Dark Falz (`DarkFalz.ts`).
- `src/game/world/Pylon.ts`: the Ruins' light pylons.
- `src/game/world/Machinery.ts`: crushers, laser fences and conveyors (Mines).
- `src/game/combat/Combat.ts`: hit resolution for photon bolts and techniques, statuses, incoming damage.
- `src/game/Game.ts`: loop, areas and the expedition run state, menus, death, saving.
- `src/game/models/`: procedural rigs and models (humanoid, booma, dragon, cave enemies, De Rol Le, Mines machines
  and the Warden in `mines.ts`, weapons, props).
- `src/viewer.ts` + `viewer.html`: standalone model viewer; `runlab` and `charlab` pages compare run cycles and character looks; `maglab` compares Mag designs (`src/game/models/magDesigns.ts`); `armorlab` shows the armour evolutions.
- `src/ui/`: HUD, menus (inventory, shop, dialogs), lil-gui tuning panel. `title.ts`: title screen (save
  slots, the selected character on a teleporter pad rendered by `MenuStage.ts`) and the 5-step creation
  wizard (body, hair, face gear, colours, name). `src/menus.css`: PSO Dreamcast-style windows used by every
  menu, the pause window, prompts and toasts.
- `src/audio/`: engine (context, buses, reverb), `synth.ts` primitives, `sfx.ts` catalogue, `picks.ts` /
  `levels.ts` (chosen variants and loudness trims), `music/` (instruments, theory helpers, tracks, sequencer).
  `src/game/audioCues.ts` turns field-enemy and lava-vent state changes into sounds; bosses, combat, the game
  and the menus call `sfx()` directly. `soundlab.html` + `src/soundlab.ts`: the Sound Lab.
- `src/devHarness.ts`: dev-only `window.__h` for scripted playtests (fixed-step `run`, combat `bot`).
  `.claude/simsetup.js` adds balance-sim helpers (`mkChar`, `simRooms`, `simRun`, `batch`, damage-by-source) for the
  browser console.

## Expedition 2 — Caves → De Rol Le
Agreed in the second design interview (2026-10-05) and built the same day. Numbers below are the tuned values
in `config/` (the tuning panel's **De Rol Le** and **Caves** folders edit them live).

### Structure
- **Unlock:** the city teleporter offers the Caves once this character has killed the Dragon (`stats.bossKills.dragon`).
  Expeditions are data (`expeditions` in `data/areas.ts`): their floors in order, the boss arena last. Each
  floor reached is a checkpoint (see Death & Saves).
- **Cave 1** (volcanic, 7 rooms) → teleporter → **Cave 2** (flooded marsh, 8 rooms incl. a switch side room;
  its first room has a teleporter to Pioneer 2) → teleporter to De Rol Le.
- Tuned for **Lv 12–22**. A bot run from Lv 15 with tier-3 gear finished at Lv 18 with 84 kills; pure fight
  time was ~11.5 min, so a real run is roughly 25–30 min.
- Forest 1 is unchanged.

### Enemies (`enemies/Enemy.ts`, `enemies/caveEnemies.ts`, `models/cave.ts`)
- `Enemy` is now a base class (Hittable, statuses, death, tinting, elite aura). `Brawler` is the old Booma AI;
  `Lily`, `Migium`, `PanArms` and `Hidoom` build on it. `enemies/spawn.ts` picks the class from `arch.ai`.
- **Cave Booma family** (red / teal / ash grey), with tougher stats.
- **Poison Lily**: rooted and immovable. It coils for 0.5 s (hitting it now cancels the shot), then lobs a glob
  whose landing circle gives ~1.25 s to step out. A hit poisons. If you stand next to it, it does a petal-burst
  knockback. The rare **Nar Lily** (1 in 15 Lilies, red) paralyses (70%), has 280 HP and always drops loot.
- **Pan Arms**: slow brute with a 170° slam (heavy knockback). It never dies whole: at 50% HP it splits into
  **Hidoom** (fast 3-swipe claws) and **Migium** (keeps 6–10 m away, calls a lightning circle, 35% paralysis).
  A tether between the halves brightens over 12 s, then they walk together and merge (combined HP). A killed
  half re-forms after 6 s at 25% HP (a blue circle marks the spot) unless the other dies first. Re-formed
  halves, and anything merged from them, give **no XP or drops**, so the split can't be farmed.
- **Elites**: 1 in 12 spawns in the Caves. Violet floor aura and pulse, name prefix, +60% HP, +25% ATP, double
  XP and a guaranteed bonus drop (one tier richer, double rare odds).
- **Attack director** (2026-10-07, `ai` in config): every field enemy attack takes a share of a **threat budget**
  (2) from its telegraph until it resolves: melee windups and strikes, aimed shots, Lily globs and Garanz missiles
  still in the air. A **Garanz barrage takes 2**, the whole budget, until its last missile lands. An enemy that
  can't get a share keeps repositioning. Attack starts are at least 0.6 s apart, ranged starts 0.8 s. Bosses,
  facility machinery, Lily petal bursts and Volatile death blasts don't count. (Before, only melee held tokens
  and shots ran on their own rhythm, so a leap, a line shot and a barrage could all land together.) Bot runs:
  hit rates are about the same, but fights run ~10% longer because waiting enemies circle instead of standing
  in a windup.

### Statuses (on the player)
- **Poison**: 1.5% max HP/s for 10 s (marsh: refreshed to 3 s while you stand in it). A **Sol** injector cures it.
- **Paralysis**: rooted, no actions for 2 s, then a 4 s ward. A **Sol** injector cures it and grants the ward, and
  is the one thing you can still use while paralysed. HUD chips show timers. (Antidote and Antiparalysis were
  folded into the Sol mod.)
- Enemies get a **Venom** weapon special (poison: 4% max HP/s, capped at 18/s, and 8/s on bosses).

### Hazards (`world/Hazard.ts`)
- **Lava vents**: a 6.5 s cycle with a 1.6 s countdown (the ring fills) and a 1.4 s fire column. It hits the
  player once per eruption (70, softened by DFP) and enemies for 30% of their max HP, so luring brutes in pays.
- **Poison marsh**: elliptical pools that poison you and slow you to 70%. Enemies ignore them. Lilies sit behind
  them.

### Waves
- Wave entries can pin an enemy to a tile (`{ e, tx, tz }`), which is how Lilies end up behind hazards.
- `ambush: [i]`: wave *i* drops in behind the player through 1 s blue circles.
- `overlap: true`: the next wave starts once a third (or less) of the current one is left.

### Boss — De Rol Le (`enemies/DeRolLe.ts`, `models/derolle.ts`)
- **Arena**: a 10 × 30 m raft. Water, foam, mist and canyon walls scroll past while the raft stays still.
  The worm is a head plus 3 big segments that follow the head's swim trail (few parts, so multi-target techs can't hit a crowd of them). Parts under water can't be hit.
- **Phase 1**: its shell (plates on the segments, a bone mask on the head) is only a look: every hit lands in full,
  ×1.5 on the head while it rests. At 50% the shell shatters and **phase 2** starts (faster, shorter gaps).
  (Until 2026-10-17 each plate and the mask passed only 30% of damage until broken, breaking the mask started phase
  2 early, and phase 2 took +15%: about 1.17× its bar to kill. The user dropped it when rift bosses were evened out;
  base HP went 12778 → 15000 so fights outside rifts keep their length.)
- **Attacks**:
  - **Bomb barrage**: swims alongside, in reach of the deck edge. 3 volleys (4 in phase 2), each a row across
    the deck, a cross on you, or a scatter. Phase 2 barrages end on a **bomb ring** around you (a dash check).
  - **Lane slam**: the lane (7 m wide) lights while the worm rears beside it. On impact it crashes down and lies
    flat across the deck for 2.3 s (blocking the lane). In phase 2 it crashes straight back over a new lane, both
    slams on a 1.0 s warning (dash checks).
  - **Sweeping beam**: from the end nearer you. The outline shows the whole sweep (75° of the 120° fan,
    22 m range), so the far end and one flank are safe. Phase 2 sweeps back and forth. Then the **head rests**
    on the deck for 2.7 s: the weak point (×1.5).
  - **Poison spray** (phase 2): 6 puddles, one on you, that last 12 s.
- Enrages below 25%. 2300 HP, 245 ATP. Rewards: 900 XP, 1800–3000 Meseta, a tier 4–5 weapon and
  armour, a 35% chance at Rol Lance / De Rol Le Shell and a 20% chance at a Lily rare.
- Bot fights at Lv 20, tier 4: Hunter ~155 s (3 HP bars taken without dodging), Ranger ~140 s (4.3 bars).
  The Dragon at Lv 12, tier 3: 36 s, 0.6 bars.

### Loot
- **Tier 5** of every weapon kind (Gladius, Calibur, Ripper, Gungnir, Diska, Raygun, Laser, Vulcan, Launcher, Maul,
  Obelisk, Diadem) and armour line (Crimson Coat / Soul Barrier, Commander, Spirit). Requirements are about
  Lv 26–30 base, so a Mag built for that stat brings them into reach. Cave enemies drop the top three of their tiers (T2–4,
  with T3–5 for Gigoboomas, the halves and Nar Lily). Shops stock T5 from Lv 24 once De Rol Le is dead.
- Cave rares: **Lily Sting** (dagger, Venom), **Spread Needle** (shot, Venom), **Coral Rod** (rod, Ice),
  **Rol Lance** (partisan T5, Shock) and **De Rol Le Shell** (any-class barrier).

### Balance reference (bot, never dodges, damage taken in max-HP bars)
- Forest, Lv 7, tier 2: ~1.7 bars over 6 rooms. Cave 1, Lv 15, tier 3: ~4. Cave 2, Lv 18, tier 3 weapon and
  tier 4 armour: ~6.6. A player who reads telegraphs takes far less.
- After the light / heavy pass (`.claude/simsetup.js` `batch()`; the bot locks one enemy, chains every hit
  perfectly and never kites; the Ranger bot stands at 10 m). Light, Light, Heavy: Forest Lv 3, tier 1 (4 rooms)
  Hunter 117 s / 1.4 bars, Ranger 138 s / 2.9; Forest Lv 7, tier 2: Hunter 163 s / 1.3, Ranger 176 s / 3.0;
  Cave 1, Lv 15, tier 3: Hunter 199 s / 2.9, Ranger 209 s / 6.3. All Heavy (the bot's best against its one
  locked enemy): Hunter Lv 3 104 s / 1.05; Ranger Lv 3 115 s / 1.6, Lv 7 147 s / 1.5. Against a clustered pack
  of 4 Boomas, all Light beats all Heavy (Hunter 7.8 s vs 10 s, Ranger 9.3 s vs 10.8 s, less damage taken).
  Chaining 0.15 s late (no perfects) costs about 20% clear time for the Hunter and 40% for the Ranger.

## Expedition 3 — Mines → Warden
Agreed in the third design interview (2026-10-07) and built the same day. Numbers are the tuned values in
`config/` (the tuning panel's **Mines** and **Warden** folders edit them live).

### Structure
- **Unlock:** the city teleporter offers the Mines once this character has killed De Rol Le (`needs: 'derolle'`).
- **Mine 1** (the foundry, 7 rooms: slag pools, crushers, conveyor belts) → teleporter → **Mine 2** (the control
  sector, 7 rooms: laser fences, crushers, belts, power switches in reach of the fight; its first room holds the
  teleporter to Pioneer 2) → teleporter to the **Control Core** (the Warden).
- Tuned for **Lv 22–32**, a run of roughly 25–30 min.

### Room mechanics
- **Control nodes** (`ControlNode`, pinned in a wave like a Lily): every Gillchic in a node's room is linked to it
  (a cyan tether shows it). A lethal hit knocks a linked Gillchic **offline** (invulnerable) instead of killing it;
  it reboots after 4 s at 60% HP. Destroying the node shuts all its bots down at once, and each counts as a normal
  kill. A bot pays out XP and its drop only once, at its real death, and damage to a rebooted bot no longer
  charges injectors, so rebooting bots can't be farmed.
- **Power switches** (`power` features with a circuit id): a crusher, laser fence or belt wired to the circuit
  stops (or restarts). Machinery hurts enemies (crusher 45% max HP, laser 20%), so luring them in pays. The switch
  light and label show the state.
- Machinery: **crushers** (warn 1.3 s, slam), **laser fences** (2.4 s on / 2.6 s off, flicker warning, Burn),
  **conveyors** (carry you and enemies),
  **slag pools** (static molten pools in the foundry: they slow you to 70% like the marsh and add a Burn stack
  on entry, then one per second). They replaced erupting furnace grates (2026-10-07: the fire pillars were too
  much in the neon look). Sentry turrets were removed (2026-10-07).

### Burn (player status)
- Stacks up to 5; each stack drains 0.5% max HP/s. A stack falls off every 3 s standing still, **3.5× faster while
  moving** (combos and casts root you, so it pushes you to reposition); each **dash** sheds a stack outright. A
  **Sol** injector cures it. HUD chip:
  `BURN ×n · MOVE`. Sources: slag pools, laser fences, Garanz missiles (35%), the Sinow finisher, Volatile
  blasts, the Warden's laser wall, its lockdown zones and Spark Mites.

### Enemies (`enemies/mineEnemies.ts`, `models/mines.ts`)
- Machines are plain fights (no plating or weak points).
- **Gillchic** (gunbot): closes to ~9 m (never backs off, so melee can catch it), telegraphs a line shot (0.95 s),
  swipes with its pincer up close. The one gunbot type; node links make the difference.
- **Garanz** (artillery tank): walks slowly, **plants** (it can't turn) and fires a 5-missile barrage at where you
  stand; missiles only reach targets in front of it. Missile blasts also hurt other enemies caught (12% max HP; only machines until 2026-10-17) and
  **flip power switches**. Crowd it while it walks and it stomps.
- **Sinow Beat**: circles at 5–8 m, crouches (landing circle), **leaps** in with a 3-hit combo (the last hit
  burns), then **backflips** away and lands in a 1.25 s recovery: the punish window. Pairs take turns.
- **Elites** (1 in 12) roll one affix (Hard: any of eight, see "Nightmare"): **Overclocked** or **Volatile**, with
  the same rules as on Hard (see "Elites, champions and affixes"). Mines only.

### Boss — the Warden (`enemies/Warden.ts`)
Redesigned 2026-10-07: the relays, shield, rail and overload switch were too gimmicky. Now it is a pure
"where do you stand" fight against something huge.
- A **colossus** built into the north end of a 28 × 30 m hall: the first 6 m (the **alcove**) are its own, and it
  never moves. Its **core** sits low in its abdomen at the alcove's edge; that is what you hit. 9000 HP, 320 ATP.
- The deck in front is ruled into a **7 × 6 grid of 4 m cells** (the floor lines show it); every attack uses it:
  - **Floor patterns:** waves of lit cells (checkerboard, stripes, bands, rings; phase 2 adds sweeping
    diagonals). Each wave's warning (1.4 s, phase 2 1.15 s) appears as the previous one fires, and every wave
    leaves a safe cell next to the last one. 3 waves (phase 2: 5). Afterwards its **core vents** for 3 s: the
    weak point (×1.5 damage). The first vent announces itself.
  - **Laser wall:** the starting line with one 5 m gap is shown for 1.6 s, then the wall rips from the alcove to
    the back in 1.5 s: you must already be in line with the gap. Phase 2: a second wall follows, again from
    the Warden's side (never from behind you), its gap 5–8 m from the first (1.5 s warning). It burns.
  - **Lockdown:** the cell you stand on (phase 2: plus one more) becomes **burning floor for good** (damage every
    0.5 s, Burn every second, a small shove out). The boss bar shows `LOCKDOWN n/5`; at 5 it holds them 8 s, then
    **all reset to 0**, so the deck never runs out of room. It never locks down while at the cap.
  - **Intake:** the two rows nearest the alcove light up and it draws everyone toward its core for 2.6 s
    (2.4 m/s, phase 2 3.0 m/s, against a 4.6 m/s walk) after a 1.3 s warning; then those rows blast. Walk or
    dash out against the pull.
  - **Summon:** **Spark Mites** (70 HP; up to 3 per summon, 4 alive) climb out along the alcove's edge, chase
    you, squat and arm a 2.4 m burning blast (1 s fuse); killing or flinching one defuses it. Every other summon
    (every one in phase 2) adds a **Repair Drone** (160 HP, up to 2) that flies to a corner post by
    the alcove and beams repairs into the core (0.4% max HP/s each; the boss bar shows `REPAIRING`). Adds give
    no rewards and shut down with the Warden.
  - **Hand slam:** within 9 m of the alcove it may swat you: a hand rises over you (3.5 m circle, 1.4 s) and
    slams. Phase 2: a pair, 1.0 s each, a dash check.
  - Floor patterns come up twice as often as each other attack (their vent is the main damage window).
- **Phase 2** at 50% (it overclocks: shorter warnings, longer patterns, paired walls and slams). Enrages below
  25% (windups ×0.8).
- Rewards: 1600 XP, 4000–5500 Meseta, tier 5–6 gear, a modded T5 injector, a 40% chance at a
  **signature drop** and 15% at a cave rare.
- Bot fight at Lv 30, tier 6 saber, parked at the core (never dodges, stands in every zone): 106 s / 5.6 bars at
  7200 HP, then 119 s / 5.0 bars at 9000 (lockdown hit the cap of 5 and reset once). With intake and adds
  (2026-10-07, drones destroyed 4 s after they start beaming): 140 s. Left alone, two drones out-heal the bot.
  The bot never dodges, so the fast wall, intake and mites don't show in its numbers.

### Loot
- **Tier 6** of every weapon kind (Galatine, Zanbato, Vibro Edge, Vjaya, Arc Disc, Hypergun, Photon Lancer, Typhoon,
  Hyper Cannon, Quasar Mace, Monolith, Aurora Staff; reqs ATP 185 / LCK 150 / MST 230) and armour line (Bastion,
  Vanguard, Astral; reqs at the line's class stat for Lv 36), plus the any-class **Photon Barrier**. Injectors stay
  at tier 5. Mines enemies drop T4–6; shops stock T6 from Lv 32 once the Warden is dead.
- Signature drops: **Warden Core** (any-class barrier: facility hazards and Burn hit half as hard; pulling a power
  switch braces you for 3 s) and **Arc Welder** (T6 handgun, any class, new **Arc** special: heavy shots jump to two
  more enemies for half damage and stun them).

### Balance reference (bot, never dodges, never pulls switches)
- Mine 1, Lv 24, tier 5: Hunter 250 s / 2.9 bars, Ranger 249 s / 7.8. Mine 2, Lv 28, tier 5: Hunter ~273 s / 5.1,
  Ranger ~234 s / 9.6 (most of it turrets the bot never turns, and Burn it never walks off; turrets are gone now).
- 2026-10-07 telegraph pass (Gillchic swipe 0.8→1.1 s and shot 0.95→1.35 s, turret 0.9→1.4 s (since removed), Sinow crouch
  0.55→0.9 s plus a crouch before close-range combos, combo cuts land at 0.2 s instead of 0.12 s): Mine 2 Hunter
  237 s / 2.9 bars (one run).

## Expedition 4 — Ruins → Dark Falz
Planned in a question round and built on 2026-10-08. The user's calls: **Corruption** as the Ruins status, **light
pylons** in the rooms, **Dark Falz in three forms on both difficulties**, the full roster (Dimenian family, Delsaber,
Chaos Sorcerer, Dark Belra, Chaos Bringer), and **Nightmare moved up one expedition** so that the Nightmare Forest
carries on from here. My defaults, offered for veto: only violet-telegraphed attacks corrupt, Sol clears Corruption,
characters who already had Nightmare keep it, the T7 frame shows armour stage 3, injectors unchanged. Same day they
asked for the environment to be **darker and more ominous** than the first, bright temple looks. Numbers live in
`config/` (`enemies`, `pylonCfg`, `ruinsCfg`, `statuses.corrupt*`, `darkFalz`; tuning panel **Ruins** and **Dark Falz**).

### Structure
- **Unlock:** the city teleporter offers the Ruins once the Warden is dead (`needs: 'warden'`).
- **Ruin 1** (the outer temple, 7 rooms with a gate switch side room) → teleporter → **Ruin 2** (the inner sanctum,
  7 rooms; its first room has the teleporter to Pioneer 2) → teleporter to **the Altar** (Dark Falz).
- Tuned for **Lv 32–42**.
- Normal elites (1 in 12) roll **Shielding** or **Regenerating** (`RUINS_AFFIXES`; the Mines roll Overclocked /
  Volatile).

### Corruption (player status)
- Each stack takes **10% of max HP** away, up to **5** (−50% with no resistance; was 6% / −30% until 2026-10-10); current HP drops with it and heals fill only to the
  lowered max. It wears off by itself after a while (below); **pylon light** (or a Grants pool) sheds one stack a
  second, and a **cleared room**, a boss kill or Pioneer 2 clear it all. A **Sol** dose does not (2026-10-08, the
  user's call; it still cures poison, paralysis and Burn).
- **Every Ruins enemy corrupts**, on every difficulty (2026-10-09, the user's call; it had briefly been set on the
  Mines by mistake): any landed hit from an enemy or Dark Falz adds a stack, like Hell (`hellCorrupt` is set for the
  Ruins too), and every enemy wears the Corrupting chip. On Hell any landed hit may, anywhere (see "Hell").
- The Ruins' signature corrupting attacks **telegraph in violet** (a melee windup that corrupts heats up violet, not orange): So
  Dimenian cuts (always, since 2026-10-08; were 50%), Chaos Sorcerer spells, the Dark Belra slam, Chaos Bringer lasers, Dark Falz's husk pulse, the
  Angel's halves and Megid orbs (two stacks).
- HUD: the HP bar keeps its full width and the lost share shows as a cracked violet block at its right end; a chip
  reads `CORRUPT ×n · LIGHT` (the hint goes once you stand in light).
- **Seal of Light** (Dark Falz signature barrier) and **Falz Halo** (its Nightmare twin) carry Corruption −50%; any
  Corruption resistance shrinks what each stack takes (capped at 75%).
- **Corruption wears off by itself** (2026-10-08, with Hell; all difficulties). Every application, even at the cap,
  resets a shared **30 s** timer (`statuses.corruptDuration`); when it runs out, the stacks shed one every **2 s**
  (`corruptWearTime`), so there is no sudden +50% HP refill. Pylons, Grants pools, cleared rooms, boss kills and
  Pioneer 2 still clean it faster. The HUD chip shows the timer (`CORRUPT ×3 · 24s`, then `FADING`, or `LIGHT`).

### Light pylons (`world/Pylon.ts`)
- 1–2 per room (`pylons` in the room data), solid obelisks with a crystal. **R lights one**: a **5 m** circle for
  **10 s**, then **20 s** to recharge (a ring fills; the prompt counts down). A faint inlaid ring on the floor shows
  each pylon's reach even while dark.
- Inside the light: Corruption sheds, and **enemies are slowed (tempo ×0.7) and take +25% damage** (Dark Falz
  too, if it stands in one). Luring pays. (Only Dark enemies until races went on 2026-10-17: all of the Ruins'.)
- **Chaos Sorcerers** blink beside a lit pylon in their room and drain it out (1.2 s, violet tendrils on the pylon);
  any hit interrupts them. The Seal / Halo make pylons you light burn 50% longer.
- Four pylons stand near the Altar's rim.

### Enemies (`enemies/ruinsEnemies.ts`, `models/ruins.ts`)
- **Dimenian / La Dimenian / So Dimenian:** sword soldiers in packs (the Booma family's role, Brawler AI); one, two
  and three cuts a swing. So Dimenian cuts corrupt.
- **Delsaber:** shield knight. Its guard **blocks light hits from the front** (×0.12, no stagger; the ward flashes);
  a **heavy hit breaks it**: it reels and fights guard-down for 3.5 s. Circles at ~4.5 m shield up, crouches and
  leaps in (landing circle) or cuts in place, a three-cut combo, then recovers guard-down (the punish window).
- **Chaos Sorcerer:** floats 8–12 m away with two orbiting bits, **blinks** away when you come within 4 m (5 s
  cooldown), casts one of three corrupting Gi-techs: a **fire ring** round you (safe in its middle or well out), a
  **lightning field** (one circle on you, two near) or an **ice line** through you. Drains lit pylons (above).
- **Dark Belra:** a stone giant. From up to 11 m it draws its fist back and **punches down a lane** (the arm
  stretches the whole way); crowd it and it raises both arms and **slams** a violet circle round itself.
- **Chaos Bringer** (Ruin 2, one at a time): a centaur. It rears and **charges down a lane across the room** (to the
  wall; the whole threat budget, so nothing else attacks; it can't be flinched mid-charge, and skids into a long
  recovery), fires a **fan of three corrupting chest lasers**, and stomps if you stand under it.
- **Field balance** (bot, never dodges, never lights pylons; `.claude/simsetup.js` SETUPS hR / rR / hR2 / rR2):
  Ruin 1 Lv 34 tier 6: Hunter-like ~275 s / ~3.2-4.3 bars (champion-free variance), Ranger-like ~290-310 s /
  ~8.3-9.3. Ruin 2 Lv 38: Hunter-like ~340 s / ~3-4.3, Ranger-like ~350 s / ~8.2. About 11-20 Corruption stacks a
  floor for a bot that stands in everything. The Mines for comparison: 250 s / 2.9 and 249 s / 7.8.
- Area attack multipliers scale ATP **before** DFP comes off, so a multiplier much under ~0.9 barely scratches at
  these levels (the first Delsaber cuts did 1 damage).

### Boss — Dark Falz (`enemies/DarkFalz.ts`, `models/falz.ts`)
On a round altar (14 m radius) floating over the void. **14000 HP, 450 ATP**, three forms on both difficulties
(the user rejected keeping the Angel for Nightmare only). Damage past a form's threshold is lost: no form can be
skipped. Each change of form takes 2.6 s (untouchable).
- **Form 1, the husk (100–70%):** a crystal cocoon with a great eye hovers at the centre. **Darvant lanes**: three
  waves of three parallel lanes across the altar (one always on you), each wave's warning showing as the last one
  fires, Darvants streaking along them. Lanes (2.6 m) sit on slots 3.6 m apart and never on neighbouring ones
  (2026-10-17, the user stood between two and was hit: their 1 m gap looked safe, but every hit counts your body,
  0.45 m round, so only its middle 0.1 m was; 74% of waves had one). The narrowest gap is now 4.6 m. Checked: the
  drawn red areas match the hit areas exactly (7,200 sampled points), and standing midway between two lanes took no
  hit over 30 waves. A **ring dive** (a 3.2 m circle on you, Darvants spiralling in); stand
  within 6 m and it often **pulses** a corrupting 5.5 m shockwave. After a lane or ring flight **the husk opens for
  3 s (×1.5 damage)**. Everything is walkable.
- **Form 2, Dark Falz (70–35%):** a winged demon with scythe arms glides after you. **Scythe** sweep up close (110°
  cone, 5 m); **Grants** (three light pillars, one on you, that crash down and then **stay as light for 4 s**,
  cleansing Corruption: risk / reward); **Megid** (two slow homing orbs, slower than a walk, two Corruption stacks
  on contact); **teleport slam** (the 4.2 m circle lands on you the moment it starts to vanish, and it crashes down
  there 1.3 s later: a **dash check**, a dash started by ~1 s clears it), then a long recovery. (Built first as a
  1.0 s circle shown only after a 0.45 s vanish with no warning; the user found it near impossible even with the
  dash, 2026-10-08.)
- **Form 3, the Angel (35–0%):** a radiant six-winged figure at the centre. **Light and dark halves**: the altar
  splits along a line through the centre that runs ~1.6 m from you; your half goes dark and erupts after 1.7 s, then
  the other half 1.5 s later (cross the line, then cross back); **feather volleys** (five lanes fanned at you);
  the **lance** (a 7 m lane across the altar through you, 1 s: a **dash check**). Enrages below 15% (windups ×0.8).
- **Nightmare pairs:** Grants with a Megid orb (form 2), the halves with a feather volley (form 3).
- Rewards: 2600 XP, 5500–7500 Meseta, tier 6–7 gear, a modded T5 injector, a 40% chance at a **signature drop**
  (Dark Flow or Seal of Light) and 15% at a Ruins rare. Injector worth 5 doses over its whole bar.
- Bot (parked on the body, never dodges): Lv 40 tier 7 saber, ~121-128 s, ~2.6-3 bars, 8-11 Corruption stacks
  (form 1 ~36 s, form 2 ~47 s, form 3 ~40 s). Nightmare Lv 78 tier 11: 166 s / 2.9 bars.

### Loot
- **Tier 7** of every weapon kind and armour line drops here (Ruins enemies drop T5–7); it used to be the Nightmare
  Forest's tier and keeps its stats (reqs about Lv 44 base). Shops stock T7 from Lv 42 once Dark Falz is dead.
  The T7 frame now shows **armour stage 3** (`TIER_STAGE`): stage 4 stays Nightmare-only (T8+).
- Ruins rares (T7): **Brionac** (partisan, Shock), **Holy Ray** (rifle, Ice), **Psycho Wand** (wand, Heat).
- Signature drops: **Dark Flow** (T7 sword, Draw) and **Seal of Light** (T7 any-class barrier: Corruption takes
  half, pylons you light burn 50% longer).

### Look and sound
- Area looks (`data/looks.ts`, pick in `/arealab.html`): **Eclipse** (default: violet-black stone, crimson glyphs,
  a black sun with a burning corona), **Blood moon** (charcoal stone, ember glyphs, a huge red moon) and **The void**
  (blue-black stone, cyan glyphs, a thin aurora). Ambient light is lower than the other areas (hemi 0.7, sun 0.7)
  and fog closes in at 75–80 m; the glyph bands, pylons and telegraphs stay bright against it.
- Scenery (`Level.buildTempleScenery` / `buildAltarScenery`): columns on the wall line and against room edges
  (some broken, all solid), glyph bands along every wall, an inlaid circle per room, spires and floating stones on
  the skyline, drifting motes; the Altar is a round platform with glowing rings and spokes, a glyph band round its
  rim, an inverted spire beneath it and stones drifting round it in the void.
- Models in `/viewer.html`: Dimenian (×3), Delsaber, Chaos Sorcerer, Dark Belra, Chaos Bringer, Darvant and the
  three Falz forms.
- Sound: ~40 new synthesized SFX in the **Ruins** and **Dark Falz** groups of the Sound Lab. Music: synth
  arrangements (`ruins`: D lydian, beatless calm / flute-and-strings battle; `falz`: D minor synth-orchestral, the
  Angel and the enrage bring in choir and taiko) until ElevenLabs recordings are made.

## Nightmare
Called Hard in the code (`hard` flags, `hard.ts`, `config.hard`) and in the notes below; players see "Nightmare".

Agreed in a design question round on 2026-10-07 and built the same day, after a Lv 37 Force with tier 6 gear found
the Mines (tuned for Lv 22–32) easy: a Lv 37 heavy Zonde (~435) kills a Gillchic or a Sinow in one cast. Normal
had no content past Lv 32, so replaying the Mines ~6–7 times was enough to outlevel it. Hard takes the same three
expeditions on up the level curve, PSO style, and gets harder through mechanics as well as stats. Numbers live in
`config/` (`hard`, plus the affix fields of `affixes`); scaling helpers in `hard.ts`, affixes in `data/affixes.ts`.

### Structure
- **One new difficulty, Hard**, for Forest, Caves, Mines and (since 2026-10-08) the Ruins. Very Hard can follow later the same way.
- **Unlock:** killing **Dark Falz** on Normal opens Hard (it was the Warden until the Ruins; characters who had
  opened Nightmare that way keep it: `stats.nightmareKept`, set once when a pre-Ruins save loads). Inside Hard the
  chain repeats: Hard Caves needs the Hard Dragon, Hard Mines Hard De Rol Le, Hard Ruins the Hard Warden
  (`stats.hardKills`).
- **Chosen at login** (2026-10-07, Diablo 1 style): starting a character asks Normal or Nightmare (locked until the
  Dark Falz falls on Normal; defaults to the hardest open one). The whole session plays on it: the city teleporter
  lists only that difficulty's expeditions, and switching means Save & quit and starting again. The run state
  carries a `hard` flag; runs reset at login, so Normal and Nightmare progress never mix. Area names, Pioneer 2 included, read "(Nightmare)" on the banner and in the menu.
- **Level bands:** Forest 42–52, Caves 52–62, Mines 62–72, Ruins 72–82, carrying on from Normal (1–12 / 12–22 /
  22–32 / 32–42). The whole difficulty moved up one expedition on 2026-10-08 (the user's ask: "Nightmare Forest is
  the logical continuation of the 4th expedition"); it was Forest 32–42, Caves 42–52, Mines 52–62 before.
- **Same maps and wave lists** as Normal (remixed waves were considered and left out). Field enemies get per
  expedition HP / XP / Meseta multipliers and flat ATP / DFP additions (ATA / EVP too until 2026-10-09) (multiplying ATP would widen the
  gap between grunts and brutes too much): Forest HP ×6.8, ATP +240; Caves ×4.7, +280; Mines ×2.9, +255; Ruins ×2.6,
  +270 (before the shift: Forest ×6 / +195, Caves ×3.4 / +190, Mines ×2.2 / +165). XP multipliers keep the levelling
  pace for the higher bands (22 / 5.7 / 3.4 / 3). Boss adds (the Warden's Spark Mites and Repair Drones) get the
  Mines scaling.
- **No XP falloff** for being above a band: Hard is where the XP is, but levelling anywhere stays allowed.
- Techniques scale with MST only (no disks since 2026-10-07; see Loot & Progression), so a Force keeps growing
  through MST from levels, Mag and Hard-tier gear. (At Lv 82, the top of the bands, a build has 81 of the Mag tree's 112 squares.)

### Technique defence
- Nightmare enemies and bosses have **MDF 20** (techniques −17%); see "Hell" -> "Technique defence (MDF)".

### Tempo: busier, not shorter
- Recoveries and attack cooldowns ×0.8, movement ×1.1: enemies attack more often.
- Telegraphs only ×0.9 and never pushed below 0.8 s (one already shorter stays as it is), so the readability
  pass on the Mines isn't undone.

### Elites, champions and affixes
- **Elites everywhere** on Hard (the Forest included), 40% of spawns (1 in 8 until a 2026-10-07 retune, 1 in 4 until
  2026-10-09): **one affix** from the whole pool. Counting champions, about 46% of Nightmare room enemies carry at
  least one affix and about 10% two (it was ~32% / ~9%).
- **Looks** (agreed 2026-10-07): the floor glow only marks rank (violet elite, gold champion). Each affix has its own
  effect on the body (`enemies/affixFx.ts`), placed so a champion's two don't overlap, so you can read it without
  the enemy frame: Overclocked cyan sparks over the body and speed streaks behind it; Volatile an orange core glow
  that throbs faster as it weakens, smoke on top; Shielding teal rings orbiting the waist (its own hex bubble once
  alone) and a wireframe hex bubble on each ally it protects; Regenerating green motes spiralling up (grey while
  suppressed), a green flash and a "+N" when it or an ally heals; Splitting a yellow seam down its middle that
  widens as it weakens; Molten a charred body glowing through its cracks, embers and drips; Stormcaller a storm cloud
  over its head with lightning into it; Frenzied steam venting as it nears 40%, then red flames and 10% bigger.
- **Champions:** each room has a 70% chance of one (60% until 2026-10-09; never a control node), **two affixes**, gold aura and a gold
  enemy frame, ×2 HP and ×1.15 ATP (an elite is ×1.6 / ×1.25), ×4 XP, two bonus drops with tripled rare odds and a
  25% chance at a tier 6 injector. Normal keeps today's elites (Caves plain, Mines Overclocked / Volatile).
- **Affix pool** (all expeditions on Hard). Reworked 2026-10-07 to be harder (the user's calls; the same rules
  apply to Normal Mines elites). The combat bot never dodges, so these are tuned by playing (`affixes` in config):
  - **Overclocked** (cyan): ×1.5 movement and attack speed, and every attack is followed at once by one more (the
    attack token is kept; `Enemy.followUp`): a swing with a 0.6× windup, another Lily spit, Migium circle or gunbot
    shot, a second Garanz stomp (never a second barrage), one more Sinow finisher before its backflip.
  - **Volatile** (orange): while you are within ~3.6 m it vents a 2.6 m blast around itself every 4 s (0.9 s warning,
    adds Burn). Its death blast is 3.8 m and leaves burning ground for 4 s.
  - **Shielding** (teal): tethers up to 3 allies within 8 m; they take 50% less damage (70% until 2026-10-09). While it has allies it hangs
    back 2.5 m behind them (away from you) instead of fighting, unless you reach it. Alone, it takes 30% less
    damage from any side (until 2026-10-09: 60% less, only from hits in front of it).
  - **Regenerating** (green): heals 4% max HP/s once it hasn't been hit for 2 s; every 8 s it pulses a heal of 12%
    max HP to allies within 6 m. Burn or Poison on it stop both.
  - **Splitting** (yellow): on death splits into three small, fast copies that give no XP or drops (the Pan Arms rule).
    The copies are plain, lesser versions of the base enemy: 35% of the type's own HP (not the elite/champion bar),
    never elite, no affixes (2026-10-07: inheriting a champion's other affix was too hard). Only walking brutes and
    machines roll it. The copies spawn inside the room, and the room doesn't count as cleared until they're out.
  - **Molten** (red-orange): a burning patch (1.3 m, 6 s) every 0.55 s while it walks; where its attacks land burns
    too (swings, and any area attack); every ~4 s it lobs 2 globs, one near you and one around itself (1 s warning,
    the Cave Lily's lob) that land as burning patches. Immune to Burn.
  - **Stormcaller** (lilac): every ~4.5 s in combat, 3 lightning circles: one on you, one where you are heading
    (your velocity × the 1.2 s warning, up to 5 m), one near you (1.5 m, 40% paralysis). They don't take the
    threat budget (nor do Volatile vents or Molten globs).
  - **Frenzied** (red): crossing 40% HP it roars (3.5 m, knocks you back); then it runs at ×1.3 tempo (capped at ×1.5
    combined with Overclocked), hits 30% harder and can't be staggered or stunned (freezing still works; its frame shows it stun-immune).
  Considered and left out: Insulated (half technique damage; the name went to the freeze-resistance CC affix on
  2026-10-16) and Frost aura (slow).
- **Enemy frame:** a coloured chip per affix under the name (2026-10-07: the first-time description lines and the
  "[LOCK]" tag were removed; the lock-on reticle already shows the lock; since 2026-10-16 the frame is the camera's
  target's, see "Controls"), and since 2026-10-16 a row of
  crowd-control resistance chips under them (see "Crowd control on enemies").
- **Enemy HP bar** (2026-10-16, the user's ask; PSO showed none): a red bar across the bottom of the frame, under
  the CC chips, quarter ticks, the % in its middle (rounded down, never 0% while alive), and the player bar's damage
  trail (a hit's chunk lingers 0.5 s, then drains). Switching targets resets the trail. The boss bar has the same bar
  at its bottom, taller (18 px), for the whole boss's HP (Dark Falz's three forms share one bar).
- **Crowd-control resistance** (2026-10-16): 30% of regular Nightmare enemies roll one CC affix, elites one,
  champions two, at 20-35% each (see "Crowd control on enemies").

### Bosses
- HP ×13.5 / ×7.8 / ×2.45 / ×2.4 and ATP +375 / +345 / +320 / +310 (Dragon / De Rol Le / Warden / Dark Falz; before
  the shift ×9 / ×6.5 / ×1.9 and +330 / +300 / +270). Flat damage (breath and beam ticks, the laser wall, burning
  zones) ×3.2 / ×2.4 / ×1.9; mask and shell plates scaled with HP (the shell soaks nothing since 2026-10-17). The Warden's Repair Drones
  heal off the Normal HP pool (times the flat multiplier), not the bigger bar, or two drones would out-heal a
  Lv 70 player. XP 3600 / 6400 / 9000 / 12000.
- **Paired attacks:** two telegraphs at once in the later phase, always with a safe route:
  - **Dragon** (below 50% HP): its fire breath comes with a tail quake, a 6 m ring around it landing 0.5 s after
    the breath starts. Safe: sidestep out of the cone, then out past the ring.
  - **De Rol Le** (phase 2): the first lane slam of the pair comes with a row of mines across the deck, 2.5 m
    clear of the lane's edge on one side (safe: the other side, or the strip between). The beam comes with a
    poison spray (six puddles, one on you).
  - **Warden** (phase 2): the first laser wall comes with a hand slam (3.5 m, 1.4 s) on you, but never on the
    gap's lane: it lands before the wall sets off, and stepping toward the gap clears both. Early in a floor
    pattern, the cell you stand on is locked down too.
  - **Dark Falz**: Grants come with a Megid orb (form 2); the light / dark halves come with a feather volley (form 3).
- No new attacks or phase 3 for the first three bosses (Dark Falz has its three forms on both difficulties).

### Loot
- **Tiers 8–11** of every weapon kind and armour line (Forest T8, Caves T9, Mines T10, Ruins T11; weapon reqs ATP
  245 / 275 / 305 / 335, LCK (was ATA) 180 / 195 / 210 / 225, MST 290 / 320 / 350 / 380; armour reqs at the line's class stat for
  Lv 52 / 60 / 68 / 76). Tiers 7–9 kept their numbers when the Ruins took T7; T10–11 are new. Hard enemies drop
  the top three tiers up to their expedition's (Forest T6–8 ... Ruins T9–11).
- **Hard rares** (each moved up a tier with its expedition): Verdant Edge (saber, Draw) and Thornshot (shot, Venom)
  in the Forest (T8); Magma Blade (sword, Heat) and Glacier Wand (wand, Ice) in the Caves (T9); Overcharge Gatling
  (mechgun, Shock) and Reactor Rod (rod, Heat) in the Mines (T10); Excalibur (saber, Shock) and Heaven Punisher
  (rifle, Ice) in the Ruins (T11).
- **Signature drops** (40%): Elder Dragon Scale (T8 any-class barrier), Abyssal Carapace (T9 any-class barrier),
  Overseer Cannon (T10 handgun, Arc), Falz Halo (T11 any-class barrier, the Seal of Light's effects). Hard bosses also drop their tier, a 25% Hard rare, +1000 Meseta (once a
  Trimate + Trifluid) and a modded tier 6 injector.
- **Injector tier 6** (Prime Mate 47% / Prime Fluid 38% a dose; reqs DFP 125 / MST 200), only from Hard bosses
  and champions. The new injector mods the design mentioned are not built yet.
- Shops stock tier 8 / 9 / 10 / 11 from Lv 52 / 62 / 72 / 82 once the matching Hard boss is dead (tier 7 from Lv 42
  after Normal Dark Falz, or the Hard Dragon for characters from before the Ruins).

### Balance reference (bot, never dodges; `.claude/simsetup.js` SETUPS hHF / hHC / hHM / hHR, last arg = Hard)
- After the shift (2026-10-08, one or two runs each, champions make it noisy): Hard Forest Hunter Lv 44 tier 7:
  ~350-400 s / ~6-7 bars at HP ×7.4 / ATP +260-240 (then lowered to ×6.8 / +240). Hard Cave 1 Lv 54 tier 8: 313 s /
  5.2. Hard Mine 2 Lv 66 tier 9: 329 s / 3.5. Hard Ruin 2 Lv 76 tier 10: 728 s / 17.5 at ×3.2 / +290 (champions,
  affixed Delsabers whose guards blocked the bot's light hits), then lowered to ×2.6 / +270: needs a real playtest.
  Bosses: Hard Dragon Lv 50 tier 8: 111 s / 2.2 bars; Hard De Rol Le Lv 60 tier 9: 146 s / 0.9; Hard Warden Lv 70
  tier 10: 187 s / 10.3; Hard Dark Falz Lv 78 tier 11: 166 s / 2.9.
- Before the shift:
- Hard Forest (6 rooms), Hunter Lv 37 tier 6: ~340 s / ~4.3 bars (before tuning: 6.5, a third of it champions).
  Hard Caves (Cave 1), Hunter Lv 46 tier 7: ~280 s / 4.3. Hard Mine 2, Hunter Lv 56 tier 8: ~380 s / 3.4 at HP ×2.45,
  then lowered to ×2.2. For comparison, Normal Mine 2 at Lv 28: 237 s / 2.9.
- Bosses (bot parked on the boss): Hard Dragon Lv 40 tier 7: 94 s / 2.0 bars (Normal Lv 12: 34 s / 0.5). Hard De Rol
  Le Lv 50 tier 8: 159 s / 2.3 (Normal Lv 20: 61 s / 0.3). Hard Warden Lv 60 tier 9 with the bot killing drones:
  165 s / 8.3 (Normal Lv 30: 174 s / 10.7).

## Hell
Planned in an ideas round and built on 2026-10-08. The user's picks: every enemy corrupts, a third boss phase with
triple telegraphs, a new armour tier with new visuals (stage 5, see "Armour looks"), a **Haste** stat, far more
affixed enemies, and Corruption wearing off by itself everywhere. Turned down: Corruption as a power upside, a Shade
that hunts heavily corrupted players, Darkened drops, pylons in every area, Falz-spawn incursions, immunities,
Hell-only affixes, named monsters, a Dark Falz 4th form, Sealed weapons, death penalties. Numbers live in `config/`
(`hell`, `hasteCfg`, `statuses.corrupt*`); the run state's `hell` flag (with `hard`, since Hell uses Nightmare's
mechanics); `src/game/difficulty.ts` names the three difficulties.

### Structure
- A third difficulty after Nightmare, **unlocked by killing Dark Falz on Nightmare** (`hellOpen`), picked at login
  like the others (the picker starts on the hardest one open). Inside it the boss chain repeats (Hell Caves needs
  the Hell Dragon, and so on; `stats.hellKills`). Area names read "(Hell)". Debug panel: "unlock Hell".
- **Level bands:** Forest 82–87, Caves 87–91, Mines 91–96, Ruins 96–100 (2026-10-08, with the level cap of 100;
  they were 82–122 and `MAX_LEVEL` 130). Hell is where levelling hands over to gear.
- **Same maps and waves.** Field enemies scale per expedition the Nightmare way. When the bands were squeezed the
  numbers came down with the lower player levels (HP by (new mid level / old)^1.5, ATP ~4 and DFP / ATA / EVP ~1.5 a
  level): Forest HP ×14.5 / ATP +559, Caves ×6.8 / +545, Mines ×4.25 / +497, Ruins ×3.3 / +469. Tempo is
  Nightmare's. XP ×27 / 9.2 / 3.9 / 2.2 (bosses about half) makes a level take about 48 regular kills, twice the
  old pace. No XP falloff.

### Technique defence (MDF)
- Added 2026-10-08 after a Lv 63 Mystic (MST 609, heavy Zonde ~984 dps) cruised through the Hell Forest. Techniques
  never miss and ignore DFP / EVP, so Hell's toughness (mostly flat DFP / EVP, which only cost a melee weapon
  ~12-16%) didn't touch casters: at the same level and tier a caster's heavy Zonde did ~2x a Vanguard's weapon dps
  (estimate, `dps.ts`), and Mag-built characters more.
- Enemies and bosses now have **MDF**: technique damage × 100 / (100 + MDF) (`formulas.techDefense`,
  `techDefenseMult`). Normal 0, **Nightmare 20** (−17%), **Hell 50** (−33%), on field enemies and bosses alike
  (`hard.<exp>.mdf`, `hell.<exp>.mdf`, and their boss scales). Heals and buffs are untouched.
- After: caster ~1.3x the Vanguard's dps on Hell (Forest Lv 87 T12: 362 vs 278; Ruins Lv 117 T15: 523 vs 381),
  ~1.5x on Nightmare. The damage table's note shows the foe's MDF.
- 2026-10-14: MDF became a plain technique resistance % per expedition and difficulty (Hell 14-21%), refit for
  techniques in proportion to tech damage; see "Stats: named by what they do".

### Technique defence (MDF)
- Added 2026-10-08 after a Lv 63 Mystic (MST 609, heavy Zonde ~984 dps) cruised through the Hell Forest. Techniques
  never miss and ignore DFP / EVP, so Hell's toughness (mostly flat DFP / EVP, which only cost a melee weapon
  ~12-16%) didn't touch casters: at the same level and tier a caster's heavy Zonde did ~2x a Vanguard's weapon dps
  (estimate, `dps.ts`), and Mag-built characters more.
- Enemies and bosses now have **MDF**: technique damage × 100 / (100 + MDF) (`formulas.techDefense`,
  `techDefenseMult`). Normal 0, **Nightmare 20** (−17%), **Hell 50** (−33%), on field enemies and bosses alike
  (`hard.<exp>.mdf`, `hell.<exp>.mdf`, and their boss scales). Heals and buffs are untouched.
- After: caster ~1.3x the Vanguard's dps on Hell (Forest Lv 87 T12: 362 vs 278; Ruins Lv 117 T15: 523 vs 381),
  ~1.5x on Nightmare. The damage table's note shows the foe's MDF.
- 2026-10-14: MDF became a plain technique resistance % per expedition and difficulty (Hell 14-21%), refit for
  techniques in proportion to tech damage; see "Stats: named by what they do".

### Every enemy corrupts
- On Hell **every** landed enemy or boss hit (melee strikes and area attacks, not beam ticks) corrupts
  (`hell.corruptChance` 1; it was 30% until the user's call on 2026-10-08; `Combat.hellCorrupt`, set when an area
  loads); attacks that already corrupt (violet) don't add a second stack. It is a trait, not an affix slot, so
  elites and champions keep their full affixes.
- **Corrupting chip** (2026-10-08, the user's ask: "monsters don't have the corrupted affix?"): the enemy frame
  shows a violet "Corrupting" chip first, before the affixes, on every Hell enemy and, on any difficulty, on
  enemies whose attacks corrupt (So Dimenian, Chaos Sorcerer, Dark Belra, Chaos Bringer).
- With Corruption wearing off by itself, no pylons are added outside the Ruins. Expect to sit at the cap in
  most fights: the % per stack is the tuning knob.

### More affixes
- **Every Hell enemy has affixes** (2026-10-08, the user's call after the Hell Forest still felt easy):
  regular **1**, elite **2**, champion **3** (`hell.affixCount`), on top of Corrupting. A regular with an affix
  gets the affix's body effects but no elite stats, halo or loot. (Before: only elites, one affix.)
- **Crowd-control resistance** (2026-10-16): every Hell regular rolls one CC affix, elites one or two (half the time),
  champions two, at 30-45% each (see "Crowd control on enemies").
- Elites: **40%** of spawns in the Hell Forest, 48% Caves, 56% Mines, **65%** Ruins (`hell.<exp>.elite`;
  Nightmare: 40% since 2026-10-09, so the Hell Forest ties it on elites; its regulars all carry an affix anyway).
- Champions: **every room** has one; rooms with at least 9 spawns in the Hell Ruins (the last room of each floor)
  get two (`hell.bigRoomSpawns`).
- Guard rails for that density (Hell only):
  - At most **2 affix area attacks** warning at once (Stormcaller circles, Volatile vents, Molten globs;
    `World.claimAffixArea`): one that can't start retries 0.4 s later.
  - At most **one Splitting** enemy per room.
  - Shielding and Regenerating enemies don't tether or heal each other.

### Haste (player stat)
- Swing wind-ups and recoveries and technique casts and their recoveries take **1 / (1 + Haste%)** as long
  (`hastened` in `combo.ts`); the poses follow because they are driven by combo time. Not movement, dash,
  injectors, or the chain window's grace. The damage table counts it.
- An **affix** (suffix) on weapons, frames and barriers from **tier 8** (Nightmare) up, 1% up to the tier's cap:
  T8-9 2%, T10 3%, T11 4%, T12 5%, T13 7%, T14 9%, T15 12% (`hasteCfg`). The Frail downside affix (Haste for HP)
  also starts at tier 8, so Normal gear never has Haste (the user's call, 2026-10-08). 1% is about 1% faster
  (~12-14 ms on a cast); three 12% items make 36%.
  What is worn adds up. Shops never sell it (white and blue only, and Haste would take a blue's one suffix).
- Weight classes keep their gap: Haste multiplies a heavy weapon's already longer timings.

### Loot
- **Tiers 12–15** of every weapon kind (Galaxy Saber ... Omega Saber), armour line and barrier (Sovereign Frame /
  Phantom Frame / Oracle Garment ... Imperator Frame / Phoenix Frame / Archon Garment), carrying on each table's
  steps until the squeeze: weapon reqs now ATP 355-402, LCK (was ATA) 234-258, MST 400-452; armour reqs at about the line's
  class stat for Lv 87 / 91 / 96 / 100.
  Hell enemies drop the top three tiers up to their expedition's (Forest T10–12 ... Ruins T13–15).
- **Hell bosses** can drop a main-pool unique (6%, see "Uniques"); otherwise rare gear (up
  to 6 affixes): two weapons and two armour pieces of the top two tiers, two units, a modded tier 6 injector, three
  grinders and 30k / 40k / 52k / 66k Meseta.
- Shops stock tier 12 / 13 / 14 / 15 from Lv 87 / 91 / 96 / 100 once the matching Hell boss is dead.

### Bosses
- Built 2026-10-08 (one agent per boss, each checked with scripted rolls: the safe spot is picked first and the
  rest built around it; every roll left exactly one safe pocket, reachable on foot in time, and a walker following
  it took no hits while standing still always got hit). Hell bosses scale the Nightmare way: HP ×23.6 / 13 / 4 / 3.6
  and ATP +530 / +540 / +540 / +520 (Dragon / De Rol Le / Warden / Dark Falz), flat damage ×5.4 / 3.9 / 2.95 / 2.7,
  XP 8500 / 13800 / 17600 / 22400 (`hell.bosses`, whose `hell: true` opens what follows).
- **Boss HP doubled on Nightmare and Hell** (2026-10-10, the user: bosses felt easy next to the mob rooms). Before it a
  boss had the HP of only 2.3-3.6 average rooms of its expedition (elites, champions and affixes not counted), about a
  quarter of the expedition. Now `hard.bosses` HP ×28.1 / 16.2 / 5.1 / 5 and `hell.bosses` ×48.8 / 24.6 / 7.1 / 6
  (Dragon / De Rol Le / Warden / Dark Falz): roughly 4.6-7 rooms. Normal is unchanged. Not re-simmed yet.
- **Third phase** (Dragon, De Rol Le, Warden) at **1/3 HP** on Hell, with a banner, the battle layer and a violet
  cue on the body; it keeps everything from the phases before (Nightmare's pairs included). **Every second attack
  is a triple** (the Warden: its first, then every third), alternating kinds; the attacks between are normal ones.
  Triples: **three telegraphs warned at once** (the third starts ~0.3 s after the first two and fires with them),
  **exactly one safe route**, never shortened by enrage below the floors noted.
  - **Dragon** ("The Dragon burns with Hellfire!"; hide and head pulse violet). The **Hellfire** is a violet,
    corrupting ring reaching past anywhere she can walk, warned 0.3 s after the others and landing 1.8 s later.
    - **Wing** (within ~8 m): breath + a 7 m tail sweep all round except a 60° wedge ~60° off her nose + Hellfire
      from 7 m out. Safe: tucked under one shoulder.
    - **Gap**: breath + the 6 m tail quake + Hellfire with one 4 m gap at her range, just clear of the cone.
    - **Lane**: charge + tail quake + Hellfire with the gap beside the charge lane.
    - Front warnings 1.7 s. A triple's breath holds its aim, and a triple's charge stops if it grazes a rock or
      wall (so it can't slide off its warned lane into the pocket). If no layout leaves a reachable pocket she
      attacks normally and tries again next time.
  - **De Rol Le** (after the shell is gone; "De Rol Le turns to the dark!"; its body pulses violet).
    - **Slam + mines + poison**: the lane on where you stand; a mine row leaves a 2.5 m strip after the lane on one
      side (the pocket); two rows of puddles seal the other side. One slam, full rest after.
    - **Beam + poison + mines**: the head rears 2.6 m in from your side; the beam covers all but a 2.6 m strip along
      your flank; puddles run down that strip toward the head; a mine row past you seals the far end. The pocket
      is the strip beside you.
    - Lane / beam and poison 1.6 s, mines 1.85 s. Known gap: run far down the raft while the beam sets up and it
      falls back to the Nightmare beam + poison pair.
  - **Warden** ("The Warden breaks its limits!"; visor, vents and projectors violet). The safe cell is picked first:
    never your cell, never burning, never in front of the core (its collider would shove you off), within 4.5 m.
    - **Diagonals + wall + slam**: the wall's gap is one cell wide (the usual 5 m gap left slivers) on the safe
      cell's column; the diagonal wave leaves the safe cell and one lane cell dark, and a hand slams that one.
    - **Holes + lockdown + slam**: the whole deck lights but three holes: the safe cell, your cell (locked down)
      and one more (slammed).
    - **Bands + wall + lockdown**: the bands leave every other lane cell dark and all but the safe one lock down.
    - First two warn 2.0 s (1.6 s enraged), the third 0.3 s later; the wall sweeps as usual and the core vents after.
- **Dark Falz**: no fourth form. On Hell its **third form** (the Angel; "empowered by Hell!") makes every second
  attack a triple, the two taking turns, each opening with a violet ring and pillar flare:
  - **Eclipse** (first one says "The dark swallows the altar: shelter in the light the feathers spare"): the safe
    Grants pillar lands 4–6.5 m from you (5–11 m from the centre), two more at ±120° round the altar; they land at
    1.3 s and leave light. The pillars are harmless (2026-10-18, the user got hit walking into the safe pool before its
    pillar landed: it used to strike, and "step in when it lands" was never told). At **4 s** both halves go dark at
    once (violet, corrupting) and anyone whose body touches light (a pool, or a lit pylon) is spared (it used to need
    your centre in one of the pools); feathers fire with the dark, fanned so the two other pools have no gap. (It was
    2.8 s, cut ×0.8 by the enrage; 2026-10-17, the user: too little time to react. Now `eclipseWindup` 4, never cut:
    4.7 real seconds on Hell at the Angel's ×0.85, 4.1 in a rift; the pools' 4 s of light still outlast it.)
  - **Judgement**: the altar splits and your half goes violet; a 100° feather wing covers the far quarter of the
    other half and a 7 m lance runs from the Angel across it. All fire at 2.1 s (×0.8 enraged). Safe: the near
    quarter of the other half, past the lance.
- Numbers in each boss's block of `config/bosses.ts` (`phase3At` / `hellPhaseAt`, `tripleEvery`, the windups and
  widths). Smoke test (bot, HP lowered): all four reach the Hell phase, Nightmare bosses never show more than their pairs.

### Boss mechanics
Built 2026-10-16/17 (the user: "tree of savior / world of warcraft kind, where you need to soak something or do
something besides just dodging"; one agent per boss, each in its own worktree). Hell only, all fight long (not just
the third phase), so rift bosses have them too; Normal and Nightmare are unchanged. The user picked each boss's
mechanic from a pitch: the Dragon's and the Warden's are their own reworks of it, De Rol Le's they cut down to a bomb
that poisons, and Dark Falz's they took as pitched. Not done: rift-only boss affixes. Each one keeps its windows
possible at a rift's tempo with a floor (noted below); they were built when rifts reached ×1.3, and since
2026-10-17 rift bosses run at a fixed ×1.15 (see "Falz Rifts" > "Scaling"), so most floors no longer bite.
- **A failed mechanic** (the Dragon's rampage in the open, a beat off the Warden's cell) lands `hell.mechanicHit`,
  **80% of max HP** (Corruption's cut not counted), past armour and damage taken (`BossContext.mechanicHit`,
  `Combat.mechanicHurt`). Two in a row kill from full; Corruption makes one do it. `BossContext.lightAt` gives bosses
  the pylon / Grants light test.
- **Dragon: Hellfire Rampage.** She roars, lowers her head and tracks you through a 2.4 s windup (`rampageWindup`, cut
  by the enrage, never under **2.0 real seconds**, `rampageWindupFloor`: 7.6 m walked after a 0.35 s reaction). A
  violet lane runs from her to you and ends at the rock covering you, if one does; every standing rock lays its shadow
  on the floor (a dark wedge with pale edges: the area the cover check counts) and the rock covering you lights up. The
  first one says "Hellfire Rampage: hide behind a rock!". At the launch she charges down the line (24 m/s): through a
  **cover rock** short of you, she crashes into it, the rock shatters and she is **stunned, weak point open**
  (`stunDuration`); in the open she homes in (no sidestep or dash gets out of it) for the failed-mechanic hit, knockback
  20. Due 6 s into the fight, then 16 s after the last (`rampageFirst` / `rampageEvery`), on a normal attack's turn,
  never a triple's (~20-25 s apart); never within 6 s of an eruption or 4 s of stalking before a timed burrow; only when
  a shadow is within walking reach (else a normal attack, and it stays due).
  - **Cover rocks** (Hell and rift arenas): 7 dark standing stones with pale veins and a ring at the foot
    (`coverRocks`, `coverRockR` 1.5 m), three round the middle and four toward the corners (the coverage sim's best
    layout: median walk to a shadow 4.6 m). They block like tree trunks (`level.trees`), and a plain or triple charge
    stops at one like at a wall; the rampage and the eruption break them, leaving rubble. Broken ones **rise again** over 1.2 s
    (`rockRise`) at every burrow, and whenever a rampage is due with fewer than 2 standing (`rampageMinRocks`; it
    waits), each only once nobody stands on its spot. Placed from her spawn + 6 m (`ARENA_FROM_SPAWN` in
    `enemies/dragonRampage.ts`, matching `createBoss`). A rock within 4.5 m of you fades to 30% (`seeThrough`): the
    3.7 m stones filled the screen when you hid behind one (the camera trails you; there is no occlusion fade
    anywhere else).
  - **The eruption breaks them** (2026-10-17, the user: "so you don't just mindless run and dash out of the circle").
    Every rock whose footprint the red eruption circle reaches shatters with the blast (`CoverRocks.blast`), and a
    broken one inside it stops waiting to rise; while it winds up, the doomed rocks' veins and foot ring pulse in the
    warning's red, and no rock rises inside it. They come back at the next burrow, like the rampage's, and no rampage
    comes within 6 s of an eruption, so where you lead the mound in its 4 s chase decides the cover you have for the
    next rampage. One blast breaks at most the three middle rocks (in the middle of them), never a corner one with
    them, so at least 4 always stand (a test pins it). Checked in the game: an eruption at the centre broke the three
    middle rocks; one 3 m off it broke the two it reached.
  - Scripted player (0.35 s reaction, then walk to the nearest shadow): 14 of 14 random rampages ended in a crash at
    base tempo; 16 of 16 at tempo 1.3 enraged (windup 2.02 s; 4 more setups had no shadow in reach and waited). In the
    open: exactly 80% of max HP.
- **Dragon: fire rain** (2026-10-17, the user: the Dragon was a bit too easy; "it should overlap with other mechanics
  or be on a random timer"). On its own clock, beside everything else (rampage, triples, burrows): 8 s into the fight,
  then every **12-18 s** (`fireRainFirst` / `fireRainEvery`). Each batch warns **three orange circles on you** (2.8 m,
  `fireRainRadius`), 1.2 s apart (`fireRainStagger`); each lands **2 s after its warning** (`fireRainWindup`) as a
  fireball falls out of the sky onto it, so warnings and landings take turns: warn 1, warn 2, land 1, warn 3, land 2,
  land 3 (`fireSchedule`, `enemies/dragonFire.ts`; it needs stagger < windup < 2 × stagger, which a test pins). A
  landing hits for 1.1 × ATP with Burn and leaves **burning ground for 7 s** (`fireRainLife`; a glowing disc with a
  bright rim and rising embers): 12 flat damage (× the difficulty's flat multiplier: 48 on Hell) every half second and a
  Burn stack every second while you stand in it. The first batch says "Hellfire rains down: keep moving!". Her time
  throughout (a rift's tempo); the enrage doesn't shorten it. Checked in the game (Hell, Lv 85): first warning 8.15 s
  in, then warn 2 at 9.45, land 1 at 10.25, warn 3 at 10.75, land 2 at 11.55, land 3 at 12.75; standing in a patch
  took 4 ticks of 48 in 2 s and built Burn to 5 stacks.
- **De Rol Le: poison bombs.** Every 17 s of fight (`hellBombEvery`; the first 5 s after the intro; phase 3 lobs two;
  never more than 2 on the raft) it lobs a spiked mine (`enemies/PoisonBomb.ts`) from a back segment, or out of the
  water, onto the deck 4-8 m from you, clear of its body, the other bomb and old poison. The first says "Destroy the
  bomb before it blows!". It sits armed for a **9 s fuse** (`hellBombFuse`; a ring round its base fills green to red,
  the light on top blinks faster, an outline marks the 5.5 m blast, the last 2 s a normal telegraph). **Anything can
  destroy it**: it is a camera target of its own (`DeRolLe.parts()` includes armed bombs; `owns()` counts only the worm)
  with `hellBombHp` 500 × the difficulty's boss HP (12,310 on Hell, growing with the rift tier), the boss's armour,
  technique resistance and race, and an HP bar over it; none of it comes off the boss, it gives no injector charge and
  CC, Burn and poison don't take. Destroyed, it fizzles. Otherwise it blows for 1.2 × ATP with poison within 5.5 m and
  leaves **eight 2.3 m poison puddles** (one in the middle, seven 3.4 m out; ~5-5.7 m in all) for 22 s. The fuse never
  runs under 8 real seconds (`hellBombFuseFloor`). Around the triples: no lob while one is up, no bomb starts its
  warning during one, a triple waits for a bomb already warning, and a triple whose pocket would hold a bomb or its
  poison isn't one this time (the slam tries the other side, else slams once; the beam falls back to the Nightmare
  pair). Bot, Lv 90, shop-clean tier 12: a Hunter destroys one in 1-2.4 s of focused damage, a Ranger 1.8-2.6 s, a
  Force 1.4-5 s. Ignored bombs soften phase 3 (7 of 11 triples fell back with the raft full of poison).
- **Warden: the sequence** (a memory test). The fight's 2nd attack, then every 4-5 (`seqFirst`, `seqEvery`; on a
  triple's slot it takes the next one; never during the intake).
  - **The shield** (2026-10-17, the user's call: the sign a sequence starts, and fair to melee and ranged alike): it
    opens by raising a dome over its chest (a faint shell and a turning wireframe lattice, 0.5 s to grow; it flares
    when hit). While it is up it takes **20% of damage** (`seqShield`); the bar shows `SEQUENCE · SHIELDED`. It stays
    up through all three discharges and drops (a ring, `warden.purge`) as the last one fires, when the core vents.
    The first says "It shields itself: remember the sequence!".
  - **The show**: 0.6 s after the shield (`seqLead`) the **first cell** lights in blue under a **pillar of light** and
    stays lit **2.5 s** (`seqFind`) so you can find it; then the other two light 0.75 s apart, 0.6 s each. Each rings a
    higher note (`ui.confirm` ×1 / ×1.26 / ×1.5). All three lie in the **two rows nearest it** (`seqRows`; 2026-10-17,
    the user: you fight close to it, and cells farther out went unseen), the first within 4 cells of yours
    (`seqFirstReach`: ~6.5 s from it lighting to the first discharge is ~25 m on foot, so from anywhere on the deck),
    each next one beside the one before, all different, never burning, in front of the core (the triples' rule) or
    under a parked Repair Drone (`planSequence`, `enemies/wardenSequence.ts`; with no chain that fits it attacks
    normally). (Until 2026-10-17 the first cell was yours or a neighbour anywhere on the deck, the three flashed 0.75 s
    apart with no hold, and there was no shield.) Then they go dark (0.6 s) and the **whole
  deck discharges three times, 1.9 s apart** (`seqBeat`; one red warning over the whole deck that never shows the safe
  cell; the bar shows `SEQUENCE k/3`), sparing only that beat's cell. Safe only if your centre's cell is that beat's
  (no grace: a corner shared by an L-shaped sequence would otherwise dodge every beat): the cell flashes green; off it,
  the failed-mechanic hit and the right cell flashes blue. Then its **core vents**. Spark Mites short out when it starts,
  drones keep beaming, lockdown cells keep burning, no other attacks, and the enrage doesn't shorten it. Reach: the
  worst step (a cell's far corner to 0.5 m inside its diagonal neighbour) is 6.36 m, 1.73 s on foot with a 0.35 s
  reaction. At a rift's tempo the beats never drop under **1.5 real seconds** (`seqBeatFloor`, from tempo ~1.27):
  walking covers 5.3 m and walk + a dash 7.8 m, so a diagonal step from a far corner is a dash check there. Sim (Lv 93
  Hunter, max HP 1408): standing still took 1126 on every off-cell beat; a walker following the cells took nothing.
  With the shield (Lv 95): the show runs 5.2 s and the discharges 5.7 s, all of it shielded (a 1000 hit lands 200);
  a walker stepping onto each beat's cell took nothing and the shield dropped with the vent.
- **Dark Falz: the Dark Tide and Doom** (the user's pick of the pitch: "the four altar pylons become your tool instead
  of decoration"). Each on its own clock beside the attacks (`tide*`, `doom*`).
  - **Dark Tide** (form 3; the first 2 s after the Angel arrives: "Dark motes feed the Angel: walk through them or light
    their way"): every 12-15 s, **3-4 motes** rise one after another at the rim (13 m out, spread evenly) and drift to
    the Angel at 1.4 m/s (~8 s). Each that arrives **heals 1.5% of max HP** (never past the 35% form share).
    **Walking through one absorbs it: +1 Corruption**, no damage. **Light dissolves them** (a lit pylon, Grants or
    Eclipse pools). 60% of tides come down the pylons' spokes, 8-16° off them, so each path crosses a pylon's light
    ~2.7 m from it. Violet-black with a bright rim, a trail and a floor glow; the bar shows `DARK TIDE ×n` and `HEALED`.
    Ignoring a whole tide of four heals 6%, about 17% of the form-3 bar.
  - **Doom** (forms 2 and 3; the first 8 s into form 2, then every 20-28 s; "Doom: end it in the light!"): a violet
    sigil under you (a shrinking ring, gold while you stand in light), a mark over your head and a line from the boss
    count down **6 s** (real time; the bar shows `DOOM n`). **Touching light cleanses it at once** (2026-10-17, the
    user's call: it used to wait out its count while you stood in the light), and it is never laid on you while you
    stand in light (it looks again in 2 s). If the count runs out first it
    **bursts**: ×1.4 ATP in a 3 m blast, **2 Corruption**, Darvants streaking out (visual). **There is always light to
    reach**: in form 2 it comes with Grants (no Megid orb) whose pools stay lit until it ends; in form 3 the Angel casts
    it only while a pylon within 12 m of you is ready (or lit for the whole count), watching the pylons' light to know
    (positions from `areas.falz.rooms[0].pylons`), else it waits. While a Doom runs it uses only the scythe (form 2) or
    feathers (form 3), none landing within 1.2 s of its end; no slam, lance or triple until it is over. A change of form
    wipes it. At a rift's tempo the Doom never drops under 5 s and motes never pass 1.6 m/s.
  - **The Angel runs 15% slower on Hell** (`angelTempo` 0.85, tuning panel **Dark Falz**; 2026-10-17, the user: its
    mechanics came a bit too fast): attacks, telegraphs, triples, the tide and Doom alike, on top of a rift's ×1.15
    (×0.98 in all there). So on Hell its windups are ~18% longer, motes drift at 1.2 m/s, tides come every 14-18 s and
    Doom counts 6.9 s. Forms 1 and 2 and Normal / Nightmare are unchanged.
  - Checked in the browser: motes heal, absorb (+1) and dissolve in a lit pylon; Doom is cleansed in Grants or pylon
    light and bursts outside it (Corruption 3 → 5); over 240 s no damaging telegraph landed within 1.5 s before or 2.7 s
    after a Doom's end.
- Untuned past first numbers: no balance run (the bot never moves, lights pylons or hits bombs, so it would fail
  every mechanic and its numbers would mean nothing).

### Balance reference (bot, never dodges; `.claude/simsetup.js` SETUPS hXF / rXF / hXC / hXM / hXR, last arg 'hell')
- Each band entered with the band-before's gear and no Haste: Hell Forest Hunter Lv 86 tier 11: 375-500 s /
  8.8-12 bars (Nightmare Forest Lv 44 tier 7 for comparison: 348 s / 5.7). Hell Cave 1 Lv 96 tier 12: 366 s / 8.2.
  Hell Mine 2 Lv 106 tier 13: 503 s / 8.3. Hell Ruin 2 Lv 116 tier 14 (before ×4.55 / +570 was cut to ×4.3 / +545):
  rooms s1-s4 610 s / ~16 bars, and the bot couldn't finish s5 (it can't pin down a blinking Overclocked Chaos
  Sorcerer; the Sorcerer does take damage). Nightmare Ruin 2 Lv 76 for comparison: 726 s / 14.4.
  About 50-80 Corruption stacks taken per run (the sim counts them instead of applying them).
- Bars count damage against true max HP: Corruption's lowered max isn't in them, so Hell is harder than they say.
- After every Hell hit corrupts, technique defence and every enemy affixed (2026-10-08): Hell Forest Hunter Lv 86
  tier 11: 660 s / 21.6 bars (was 375-500 s / 9-12), ~280 Corruption stacks taken; 19 regulars (1 affix), 13
  elites (2), 6 champions (3).

## Endgame: Falz Rifts
Planned in an ideas round and built on 2026-10-10. The user's picks: Path of Exile style maps, procedurally
generated; a **hybrid** source (plain rifts of any unlocked tier are free, modded ones drop); the **Falz rifts**
fiction; **medium** length (~10 min); and **item-level affix tiers** as the gear chase. Passed on for now: new base
tiers (16-18), endgame uniques, Photon crafting currency. Not decided: a Survey Board (Atlas-like meta progression)
and pinnacle bosses (Episode 2's Barba Ray, Gol Dragon, Gal Gryphon, Olga Flow). Code: `rifts.ts` (scaling,
modifiers, shards, the look), `riftGen.ts` (rooms and waves), `riftTypes.ts`, `ui/riftGate.ts`; numbers in `riftCfg`
(tuning panel **Rifts**, which also gives shards, opens every tier and warps into a rift).

**2026-10-17 redesign** (the user's plan, built in one go): the ladder was **squished** (old tiers 1-20 into 1-10)
and **ends at tier 10** (a separate final node with its own boss comes later as the end of the game);
**damage-first scaling** (heavy hits approach one-shots at the top; enemy HP back on the old curve the same day, see Scaling); regular gear keeps
improving **up to tier 10** (item level and Rift-forging), then stops; **Rift Circles**: every boss drops its own
gear unique and unique unit in each of three circles (see "Uniques"); **unique units** in the Mag; the **Swarming**
modifier; shards that **name their boss**. Not taken: uniques that rank up with boss kills (the user said no), the
Onslaught modifier, density rising with depth, Paragon levels, separate multiplier buckets.

### Structure
- **Fiction:** Dark Falz's death on Hell tears rifts in Ragol that pull the planet's creatures together.
- **Every rift rolls a random region, with every expedition's enemies** (2026-10-14, the user's call: always the
  Forest got samey; a random roll can't be gamed the way the old picker was). The floor takes the region's look
  (one of its field floors at random: Forest 1, Cave 1 or 2, Mine 1 or 2, Ruin 1 or 2, untinted, `areaDef(look)`),
  its music and its hazards (trees; vents or poison marsh; crushers, lasers, slag and belts on power switches;
  light pylons). Each **wave** still comes from one random expedition (Boomas; Cave beasts with rooted Lilies;
  gunbots, Sinows and Garanz, sometimes behind a control node; the Dark), so a room can go Boomas, then gunbots.
  `RiftInfo.region` / `.look`, rolled in `plainRift` / `shardRift`; a Bleeding shard's rift never rolls the region
  it bleeds in. The area is named "Rift · Tier 7 · Caves" (`riftName`). Hell rules hold: every hit corrupts, every
  enemy has affixes, every room a champion. (2026-10-10 to 10-11 each rift was one region, darkened toward Falz
  violet, picked at the Gate; 2026-10-11 to 10-14 always the Forest, because with the picker the Forest was always
  the easy pick.)
- **Unlock:** the Hell Dark Falz kill (`riftsOpen`), and nothing else: the **Rift Gate** only stands on Pioneer 2's
  teleporter deck once Falz has fallen on Hell, and then in every session, whatever difficulty was picked at login (rifts
  run on Hell rules regardless; 2026-10-11, the user's call: before that the Gate stood sealed from the start and only
  answered in Hell sessions) (`models/riftGate.ts`, also in /viewer.html: a dark ring on a stepped hex plinth, crowned with Falz crystal
  spikes, holding a swirling violet vortex shader, with orbiting shards and rising motes; it replaced a flat jagged
  tear on 2026-10-10 that the user found janky).
- **Rift Gate menu** (`RiftGateMenu`): *Open a rift* (tier 1 up to the highest open, with a preview of what the tier
  does: enemy HP / damage / armour against tier 1 and the step from the tier below, technique defence (boss speed
  until 2026-10-17, when it stopped growing with the tier),
  the item level, Rift-forging and the affix odds, the next loot step) and *Shards* (the stash, each shard's
  modifiers, item quantity and rarity, Enter or Shatter). A rift left open shows a Return button; opening another
  collapses it. The Gate remembers the tier you pick (`RiftSave.picked`, `pickedTier`; a pick on the top tier follows
  it up when the next one opens), and the debug panel's rift warps open that tier (2026-10-18, the user's ask; they
  used the highest open one).
- **Tier ladder: 1-10** (2026-10-17, the user's call: there was very little difference between tiers, so the old
  1-20 became 1-10, two old tiers to each; the ladder ends at 10, and a separate final node with a special boss will
  come later as the end of the game). Closing the highest open tier opens the next; tier 10 is the top (a toast says
  so the first time). Old saves are squished once on load (`riftSave`, `RiftSave.ladder` 2): the open tier, the best
  tier and every shard's tier become half, rounded up, at most 10. Before: endless from 2026-10-14 (at tier 16 with
  near-best gear most enemies died in one hit), 16 tiers until then. Debug: "open every rift tier".
- **Rift Circles** (2026-10-17): tiers **1-3 (I), 4-6 (II), 7-10 (III)**. Each circle's bosses drop new uniques
  (see "Uniques"), and circles II and III open affix tiers 7 and 8. The Gate shows the tier's circle, and its
  **Rift Circles** tab lists every boss's uniques by circle (found ones ticked, hover for the effect and cost,
  "First kill here drops one" where it's owed).
- **A rift's run** (`newRiftRun`, `Game.riftRun`): one per session, like an expedition run (cleared rooms stay
  cleared, death sends you to Pioneer 2 and the Gate brings you back to the start of the floor you reached).
  The run's `expedition` is the Forest (whatever the region); `run.rift` carries the region and look, tier, seed,
  modifiers, whether it ends at a boss and whose (`bossRegion`, rolled apart from the region). Damage estimates and ▲ verdicts measure against the average of every roster (`riftFoe`).
- **Two areas filled at runtime:** `rift` (the generated floor) and `riftBoss` (the boss's own arena, as it looks on
  its expedition); `setRiftAreas` writes both into `areas` before a rift loads. Area names: "Rift · Tier 7 · Caves",
  "Rift Core · Tier 7 · Control Core", with no "(Hell)" tag; the boss bar reads "Warden · Tier 7" (2026-10-18, the
  user's ask). After the boss, the arena plays the rift floor's music.

### Layout (riftGen.ts)
- `generateRift(options)` is pure: everything comes from the seed (mixed with the region, so one seed differs per
  region). Rooms are rectangles grown off a free side of the room before (gap 4-8 tiles, overlap at least 4, so the
  level builder's straight corridors always fit), kept 3 tiles from other rooms and 2 from corridors; of three
  fitting spots the most compact wins (maps come out about the authored floors' size). Stuck layouts restart from a
  derived seed. Numbers in `RIFT_GEN` (trimmed 2026-10-10 from 6-8 fight rooms and 4.5-5.5 a wave to aim at ~10
  minutes).
- **Rooms (8-10, plus the boss teleporter room):** a 10x10 start room (`start`, a teleporter to Pioneer 2);
  **5-7 fight rooms** on the main path, the last being the **Guardian room** (18-22 x 16-20, three waves, overlap,
  an ambush); a **switch side room** hanging off a middle fight room, whose gate switch (`L1`) unlocks the main
  path's next link; and a **bonus room** (one wave, four boxes) when the path is short, otherwise half the time.
- **Waves** fill a threat budget: about 4-5 a wave by room size, 6 in the Guardian room, at most one brute and 7
  enemies a wave, 2 waves (3 in rooms of 340 tiles² and up, 1 in the bonus room). Costs: basic 1, Gobooma /
  Cave Gobooma / Sinow / So Dimenian 1.5, La Dimenian 1.25, Garanz / Delsaber / Chaos Sorcerer 2, Gigobooma /
  Cave Gigobooma / Pan Arms / Dark Belra 3, Chaos Bringer 4 (one a room). The Caves pin Poison Lilies along the
  edges; the Mines open some rooms with a control node and three Gillchics. About a third of rooms ambush and a
  third overlap their waves. Convergence fills 40% of each wave from the second region (never Lilies or nodes).
- **Hazards** about as dense as the authored floors (`hazardMult` 2 for Ruinous): Forest trees; Caves volcanic
  (vents) or marsh (pools) rooms; Mines foundry (slag, crushers, belts) or control (lasers, crushers) rooms, most
  machinery wired to a power switch by a wall; Ruins 1-2 pylons. Bleeding gives half the fight rooms the second
  region's hazards at 60%. Nothing lands on corridor mouths, features, pinned spawns or other hazards.
- `riftGen.test.ts` sweeps 3,200 rifts (four regions, four option sets) for determinism, spacing, valid corridors,
  reachability, the lock and switch, feature and hazard placement and power wiring, and builds real `Level`s.
- **Map Lab** (`/maplab.html`): region, seed and Reroll, boss, hazards ×2, Bleed and Convergence; the rift in 3D
  from above plus a 2D map (roles, the locked corridor, features, hazards) and counts. `window.maplab` scripts it.

### The end
- **Every rift** (`riftCfg.bossChance` = 1 since 2026-10-12, the user's call when uniques became boss drops; it was
  a third) ends in a teleporter room to a random one of the four bosses (`toBoss` to `riftBoss`) with its Hell third
  phase. The **Guardian room** ending (big, three waves, two champions with one extra affix each, and a teleporter to
  Pioneer 2) is still in the code for `bossChance` below 1, but no rift rolls it.
- **Closing a rift:** "RIFT CLOSED" banner (the boss's own on a boss), the next tier opens, and the end loot drops
  (`rollRiftEndDrops`): Meseta, a rare tier 15 weapon, a rare tier 14-15 armour piece and a unit; a boss adds a
  second weapon, armour piece and unit, a modded tier 6 injector and a grinder. All at the rift's item level. The
  boss's **own unique** rolls apart (`rollBossUnique`, riftCircles.ts; see "Uniques").

### Scaling (`riftScale`, `riftBossScale`)
- **Damage-first** (2026-10-17, the user's call: the danger is what enemies deal, until a heavy hit almost
  one-shots at the top). Per tier, compounding (`riftGrowth`, all on the tuning panel):

  | Per tier | Field enemy HP | Boss HP | Heavy hits | Chip damage |
  |---|---|---|---|---|
  | `riftCfg` | ×1.25 | ×1.40 | ×1.20 | ×1.08 |
  | at tier 10 | ×7.5 | ×20.7 | ×5.2 | ×2.0 |

  **HP retune, same day:** HP first came down to ×1.08 / ×1.15 a tier (×2.0 / ×3.5 at tier 10) so rooms would be
  quick, but the user's near-top Force (66% Haste from Haste and Frail on every piece plus a Frail unit, Lightning
  +48%, three Brittle; Zonde 49k a cast, 67k a second) killed tier 10 enemies in one cast and bosses in about 22 s,
  before they could swing, while a tier 10 heavy hit would have taken about five times its HP: "everything dies
  first, or one touch kills you". Gear grows about 5-8× from Hell entry to the top, so HP has to keep pace: field HP
  went back to the old curve (×1.12 per old tier is ×1.25 per new one), bosses ×1.30, then ×1.40 when bosses still
  died too fast (the user's call, same day). With that gear a tier 10 enemy takes about 2 Zondes, an elite 3.5, a
  Chaos Bringer elite 6, and a boss about 130 s of pure damage. Tier 1 is unchanged (bosses 420k, like Hell's). A
  Haste cap was offered (+40% / +50%) and declined (the user's call).

  **Heavy hits** are melee strikes, slams, charges and every boss attack (its flat damage too: breath and beam ticks,
  burning zones). **Chip damage** is ranged shots (Lily spit, Migium lightning, gunbot and Garanz shots, Sorcerer
  spells) and elite affix side attacks (Volatile vents, Molten globs, Frenzied roars, Stormcaller circles): those
  call `ctx.shotStrike`, which takes the enemy's `arch.chipMult` share of its ATP. A failed boss mechanic is still a
  fixed share of max HP. Rift gear had made hits tiny (a geared Hunter took about 1% of max HP a hit at tier 1, a
  Force 3%), so tier-1 damage is lifted too: heavy ×8 (`heavyBase`), chip ×4 (`chipBase`). Measured before the HP
  retune (Lv 100 Hunter, tier 15 rares at affix tier 8, 75% Strike cut, bot that never dodges): tier 1 hits average
  4.5% of max HP (worst 11%), tier 10 average 25% (worst 58%, 80% in a Swarming rift).
  The Rift Gate shows what a tier deals to you ("a heavy hit takes about 45% of your HP, the hardest 69%, a shot
  9%", `riftThreat`). Forces take about three times a Hunter's share. **Armour and technique resistance no longer
  climb with the tier** (they only made rooms slower). Before: HP ×1.12 and damage ×1.07 per old tier, armour and
  resistance creeping up to tier 16.
- **Every rift boss has the same HP** (`riftBossHp`; 2026-10-17, the user: De Rol Le felt tankier than Dark Falz,
  and the numbers should be even and grow with the tier): **420k at tier 1** (`riftCfg.bossHp`, about the four's
  average before), ×1.40 a tier (1.6M at tier 5, 8.7M at tier 10; ×1.15 and then ×1.30 for a few hours on 2026-10-17) and ×1.4 with Tough; `bossHpMult` (all 1) can trim one, and both
  are on the tuning panel. Before, each kept its own Hell HP lifted to Lv 100: Dragon 384k,
  De Rol Le 375k (but ~440k to kill through its shell, since dropped), Warden 390k, Dark Falz 478k at tier 1.
  Damage still differs per boss (`RIFT_BOSS_LIFT`).
- **Each enemy scales from its home expedition** (`enemyHome`): that region's Hell numbers lifted to Lv 100 (HP by
  (100 / the band's middle)^1.5, ATP +4 and DFP +1.5 a level, the rule used when the Hell bands were squeezed; since
  2026-10-14 ATP, armour % and technique resistance % by a per-region lift refit against tier-15 gear, `RIFT_LIFT`). So a
  Booma and a Chaos Bringer stand as far apart as on Hell, and tier 1 is about the Hell Ruins everywhere.
- Old per-tier numbers (2026-10-14 to 10-17): HP ×1.12 and damage ×1.07 compounding without end, armour +0.25% and
  technique resistance +0.8% a tier up to tier 16. (Before that: HP ×1.065, ATP +15 flat, bosses' flat damage +3% a
  tier; earlier still ATP +12, DFP +4, MDF 50 to 75.)
  Tempo, telegraphs and XP are Hell's, except bosses: each runs at a **fixed ×1.15 at every tier**
  (`riftCfg.bossTempo`, one per boss, tuning panel **Rifts**), attacks, recoveries, telegraphs and its mechanics'
  clocks alike. 2026-10-17, the user's call once the Hell boss mechanics came in: deeper rifts get harder through
  the bosses' damage (doing the mechanics becomes a must) and HP (longer to keep executing flawlessly), not speed;
  ×1.15 is the middle of what it replaced. From 2026-10-12 it was **+2% a tier up to tier 16** (×1.3 from there;
  with rift gear's damage, Haste and run speed, Hell-speed bosses had left long windows and played easier than the
  mob rooms), which made the mechanics come ever faster. (Chill used to multiply on top; bosses ignore crowd control
  since 2026-10-16.) The shortest boss warning (the Dragon's enraged charge, 0.66 s) is about 0.57 s in a rift.
- Where the wall sat before the 2026-10-17 redesign (analytic, `estimateDamage`, Lv 100 Hunter, single target, talents and area hits left out):
  Hell-entry gear (tier 14 rares, mid rolls) kills a Booma in 0.9 s and a Chaos Bringer in 2.9 s at tier 1; top
  tier 16 rift gear (tier 15 rares, every affix maxed at tier 8, Rift-forged +48%) about twice as fast. With the new
  steps that top gear takes 2.8 s / 8.7 s at tier 16 (1.3 s / 4.1 s before), 4.3 s / 13.7 s at tier 20 and 7.6 s /
  24 s at tier 25, so near-best gear should stall somewhere around tiers 20-25. Gear found deeper pushes it a little
  further: Rift-forging keeps adding 3% a tier (tier 22 gear is ~10% more damage than tier 16's), about one tier
  for every six of forging, so the climb slows to a crawl instead of stopping. Enemy hits on a Hunter at the 75%
  strike cap stay small (3-7% of max HP at tier 25); for them the wall is kill time and Corruption, not damage.
- Elites: 65% of spawns (the Hell Ruins' share). Rooms with 9+ spawns get two champions anywhere.
- Crowd-control resistance (2026-10-16): Hell's CC affixes, +3% a tier up to tier 8 and one more at every rank
  from tier 5 (`riftCc`; both doubled with the squish; see "Crowd control on enemies").
- Balance reference (bot, never dodges; Lv 100 test Hunter, `testCharacter` kit, tier 1, Guardian end): before the
  trim, Mines 8 fight rooms in ~690 s of fight time and ~5000 HP taken (~2.3 bars); after it, Ruins 8 fight rooms in
  ~320 s and ~7300 HP (~3.4 bars). Untuned past that: every number is a first draft.

### Modifiers and Rift Shards
- **Rift Shards** drop in rifts only: the Guardian or boss **always drops one**, and the rift's item quantity is
  the chance of a second (+40% quantity: 40%); rift champions drop one 3% of the time (also scaled by quantity).
  Every rift pays at least one, so plain rifts sustain the supply (2026-10-10, the user's pick after two empty
  rifts; it was 60% at the end, which left about 30% of rifts with none). They go to the Gate's **stash** (30), never the bag,
  taken by walking over them (a violet crystal with a pillar, a yellow halo on 3+ modifiers). A full stash leaves
  them on the ground.
- A shard: mostly its rift's tier (20% one up, 10% one down), **1-2 modifiers (blue) or 3-4 (yellow, 40%)**, at most
  one forced affix and one crowd-control modifier; Bleeding names the region whose hazards come through (Caves, Mines or Ruins). Shards from before
  2026-10-11 lose their region and the two removed modifiers on load (`riftSave`); one left with none is dropped.
- **Modifiers** (each adds item quantity and rarity, shown on the shard; no immunities):
  - **Forced affix**: every enemy is Overclocked / Molten / Stormcaller / Frenzied / Regenerating / Volatile (added
    on top of its rolls where it fits).
  - **Exalted**: elites and champions carry one more affix. **Teeming**: elites +20% of spawns.
  - **Abyssal**: Corruption wears off half as fast. **Bleeding**: the Caves', Mines' or Ruins' hazards in half the
    rooms. (Ruinous, twice the hazards, and Convergent, a second region's enemies, went with the single-region
    rifts: the Forest's only hazard is trees, and every rift mixes every region now.)
  - **Hasted**: enemies move and attack 20% faster. **Swift**: wind-ups 15% shorter, never under 0.8 s.
  - **Starved**: injectors charge 30% slower. **Hardened**: enemy HP +40%. **Brutal**: enemies hit 12% harder.
  - **Steadfast / Insulated / Relentless / Anchored** (2026-10-16): every enemy resists stun / freeze / slow /
    knockback at least 50% plus the tier's growth (capped at 75%), on top of its own CC affixes. Quantity +8%,
    rarity +6% each.
  - **Swarming** (2026-10-17, the user's ask): far more enemies in every wave. Each wave's threat budget ×1.6, the
    extra filled with fodder (threat 1.25 or less) up to 11 a wave (`RIFT_GEN.swarm`); fodder never comes in elite
    (`RoomDef.fodder`). The attack director still lets two attacks be live at once, so it adds targets and steady
    pressure, not burst. Quantity +10%, rarity +5%.
- **Boss-pick shards** (2026-10-17, Rift Circles): 30% of shards name the boss their rift ends at ("Summons: the
  rift ends at the Dragon", `RiftShard.boss`, `riftCfg.bossShard`), on top of their modifiers, so a hunt for one
  boss's uniques can be aimed. Plain rifts still end at a random one.
- **Item quantity** multiplies every enemy's drop chance, which can pass 1: the rest is the chance of a second drop
  (`rollEnemyDrops`). At the end it adds rare gear (weapon, armour or unit) on top of the fixed pieces: quantity x 3
  on a Guardian, x 6 on a boss (+50%: 1.5 or 3 more). **Item rarity** multiplies rare-item odds; the rift's rarity
  also raises a rift boss's unique odds. Rift Shard odds use only the shard's own quantity, so the stash doesn't flood.
- **Every tier adds its own** (2026-10-12, the user's call): item quantity +10% and rarity +12% per tier (+100% /
  +120% at tier 10, doubled with the squish; `drops.riftQtyPerTier` / `riftRarePerTier`), and a shard's modifiers
  add theirs on top (`riftLoot`). The Rift Gate shows the tier's bonus in its preview, and a shard's total (tier plus
  modifiers). Meseta +10% a tier.

### Item level and affix tiers 7-8
- A rift's drops roll at **item level 100 + 2 x its tier** (102 to 120; `riftIlvl`, `ItemInstance.ilvl`; the card's
  type line shows it), so the squished ladder kept its loot. Gear bases stay tiers 13-15.
- Two new affix strength tiers: **tier 7 from item level 108** (rift tier 4, Circle II), **tier 8 from 114** (rift
  tier 7, Circle III; until 2026-10-17 105 and 112, old tiers 5 and 12).
  They extend each affix's authored six: tier 7 adds half of the tier 5-to-6 step, tier 8 the whole step
  (`tierRange`; e.g. weapon ATP% 26-32 at tier 6, 29-35 at 7, 32-38 at 8). Penalties grow the same way.
  Haste and unit kinds are unchanged.
- Rift rares, like Hell's, have **6 affixes and 3 dormant** (they rolled 5-6 from item level 110 until 2026-10-13).
- **Rift-forged** (2026-10-11, the user's pick after rift tier 7 gear still lost to their Hell Ruins rod): rift drops'
  base stats (weapon ATP and stat bonuses, armour DFP and bonuses) are raised **3% per item level above 100**, 6% a
  rift tier (+6% at tier 1, +48% at tier 8, **+60% at tier 10**, the top; `drops.riftForgePerTier`, `statDef` /
  `forgeMult` in character.ts); the card's type line says "Rift-forged +48%". The built-in grind (Edge, and
  armour's) is a share of the forged numbers. 2026-10-17, the user's call: regular gear keeps adding a little up to
  the deepest tier while you farm for uniques, then stops (`RIFT_TOP_ILVL` 120; drops from the old, deeper tiers
  count as from tier 10). Affix tiers stay capped at 8.
- **More and rarer finds per tier:** see "Every tier adds its own" above.
- Why (simulated, Lv 97 Force, heavy Zonde against the rift mix): a Hell Ruins tier 14 rare rod at +11 beat all but
  2.2% of tier 7 field caster weapons and 82% of the end-of-rift rare tier 15 ones. Its 11 grind levels were worth
  +33%, tier 15 over tier 14 only +2%, and affix tier 7 is half a step. After the change: 3.9% / 25% at tier 7, 8% / 38%
  at tier 13 (about 30% and 45% a rift to find a straight upgrade). Casters gain least from the forge (the weapon is a
  small share of their MST); melee more (weapon ATP is most of theirs). Not taken: pre-ground drops, leaning to tier 15
  bases.
- **Gear verdicts in Hell once rifts are open** measure against the rift mix, also right after login (before, a fresh
  session measured against the Hell Forest, all Native, so Native % weapons looked far better than in a rift).

## Uniques
Redesigned 2026-10-12 (the user's call): the thirty old uniques (fixed specials, a few fixed affixes, dropped by
enemies and as boss signatures) were **deleted**, saves included (unknown items leave the bag on load). In their
place, uniques each with **one effect nothing else has and a real cost**, meant as chase items. **Rift Circles**
(2026-10-17, the user's design) gave every rift boss its own: 24 rift uniques, half of them unique units. Code:
`data/uniques.ts` (definitions), `riftCircles.ts` (circles and drops), `combat/riftUniques.ts` (the rift uniques'
effects), `uniqueCfg` in config/progression.ts (numbers), `Character.hasUnique` and its callers (Combat, Game, dps).
- **Bosses only.** Nothing else drops them (enemies, elites, champions and boxes never do).
  - **Main game** (Normal, Nightmare and Hell bosses): three weapons (one per class until 2026-10-21). A boss kill
    rolls 2% / 4% / 6% (Normal / Nightmare / Hell, `drops.uniqueBoss`), each of the three as likely (the class's own
    counted double before).
  - **Rift Circles**: each rift boss drops **only its own**, a gear piece and a unit per circle (tiers 1-3, 4-6,
    7-10), the earlier circles' too when fought deeper (this circle's two count double). The **first kill of each
    boss in each circle always drops one** of that circle's two (one you don't have yet, if any:
    `RiftSave.firsts`); after that a kill rolls 12% (`drops.riftUnique`) plus 4% for every kill of that boss in a
    row without one (`riftUniqueDry`, `RiftSave.dry`), times the rift's item rarity. So every boss, and every
    circle's bosses, are worth farming for the power to clear the next. Boss-pick shards aim the hunt.
- **Gear base stats from an item level.** Each gear unique exists at all 15 gear tiers (`unique_<id>_<tier>`): a
  main-game drop is the tier the boss drops at (Normal: Dragon 3, De Rol Le 5, Warden 6, Dark Falz 7; Nightmare and
  Hell: the expedition's top tier, `bossUniqueTier`); a rift drop is tier 15 at the rift's item level, so
  Rift-forged. Weapons carry their kind's stats and requirement; armour no requirement and DFP between the Guard and
  Combat lines', with no line bonus (unique frames open 2 unit slots). **No affixes, no crafting.** The user turned
  down uniques that rank up with boss kills (2026-10-17).
- **Unique units** (`uunit_<id>`, one def each): learned into the Mag on pickup like any unit (walk-over, a toast,
  "N unique" on the Mag tab's list), slotted like any unit, **as many as the frame's unit slots allow** (the user's
  call). Their numbers (effect and cost) are raised by the Heart of Falz (`Character.uval`).
- The main game's three:

  | Unique | Slot | Effect | Cost |
  |---|---|---|---|
  | Dark Flow | Wand (a Sword until 2026-10-21) | Kills heal 5% max HP and remove a Corruption stack | Mate injectors don't work |
  | Frozen Shooter | Rod (a Rifle until 2026-10-21) | Ice techniques freeze; a technique on a frozen enemy shatters it for ×2.5 (thawed, then 3 s before it can freeze again) | 50% less damage (bolts too) to anything not frozen; bosses never freeze |
  | Reactor Rod | Rod | Each attack cast within 1.5 s of the last adds 30%, up to ×2 (×1, 1.3, 1.6, 1.9, 2) | Techniques cost 3× TP |

- The rift bosses' (circle I: tiers 1-3, II: 4-6, III: 7-10). Each boss has a theme. The weapons that were the
  Hunter's and Ranger's became rods and wands on 2026-10-21 (see "One character: no classes"):

  | Boss | Circle | Unique | Slot | Effect | Cost |
  |---|---|---|---|---|---|
  | Dragon | I | Red Ring | Barrier | Crit damage +100% | Corruption resistance −50% |
  | Dragon | I | Ember Core | Unit | Your Burns stack, up to 3 on an enemy | Burn on you deals 50% more |
  | Dragon | II | Flame Visit | Rod | Enemies that die Burning leave a 3 m fire pool for 3 s (pools chain); Rafoie's burning ground lasts twice as long | You Burn in your own fire too |
  | Dragon | II | Dragon Rush | Unit | Dashing through enemies hits each for a photon bolt and staggers it | Dashes recharge 40% slower |
  | Dragon | III | Dragon Fang | Wand | Kills build Rampage: +5% damage and +3% Haste a stack, up to 10, gone 3 s after the last kill; at 10, techniques cost no TP | A hit for 15% of max HP or more ends Rampage |
  | Dragon | III | Proof of Sword-Saint | Unit | First hit on an enemy at full HP deals ×3 | 25% less damage to enemies below half HP |
  | De Rol Le | I | Plague Mantle | Frame | Enemies that die poisoned burst, poisoning everything within 4 m with what they carried | Poison on you lasts twice as long |
  | De Rol Le | I | Venom Sac | Unit | Your crits poison: 20% of the crit a second for 4 s, stacking (up to 10) | Crit damage −20% |
  | De Rol Le | II | Rol Carapace | Frame | No single hit takes more than 35% of max HP (failed boss mechanics aside) | Injector doses restore 50% less |
  | De Rol Le | II | Tide Shell | Unit | After 8 s without being hit, a shell soaks one hit (up to 40% of max HP) | Run speed −10% |
  | De Rol Le | III | Ophelie Seize | Wand | Every photon bolt adds a venom stack (15% of the hit a second, 6 s), no cap; a poisoned enemy's stacks jump to the nearest enemy when it dies | Photon bolts can't crit |
  | De Rol Le | III | HP/Drain | Unit | 3% of the damage you deal heals you | Injectors don't charge from your damage (they still refill after a fight) |
  | Warden | I | Overclock Core | Frame | Haste from gear counts double | Max HP −50% |
  | Warden | I | Limiter | Unit | Techniques cast 30% faster (Art cooldowns 30% shorter until 2026-10-21) | Techniques cost 20% more TP |
  | Warden | II | S-Beat's Blade | Wand | A technique as a perfect chain's third step costs no TP | Techniques outside a perfect chain cost double TP |
  | Warden | II | V801 | Unit | Photon blast charges twice as fast; firing it refills your dashes | Photon bolts refill 20% less TP |
  | Warden | III | Prophets of Motav | Rod | Two different elements in a row complete a combo: the second hits ×2 and costs no TP, then it starts over (the user's call: two, not three) | The same element twice in a row hits 50% less |
  | Warden | III | Yasakani Magatama | Unit | Every 12 s the next attack technique casts again 0.4 s later, free | Max TP −25% |
  | Dark Falz | I | Falz Halo | Barrier | Each Corruption stack adds 10% damage | Corruption doesn't wear off and pylon light doesn't shed it (a cleared room or Pioneer 2 still does) |
  | Dark Falz | I | Devil/Battle | Unit | +3% damage for every 10% of HP missing (up to +27%) | HP regen from gear does nothing |
  | Dark Falz | II | Dark Bridge | Wand | With too little TP, techniques cast from HP (2 HP per TP short) and hit 25% harder | Max TP −40% |
  | Dark Falz | II | Soul Eater | Unit | A kill Dooms the nearest enemy within 8 m: 1.5 s later it takes 30% of the dead one's max HP (it chains) | You gain Corruption twice as fast |
  | Dark Falz | III | DF Shield | Barrier | A killing blow Dooms you instead: 4 s unkillable at 1 HP; kill 3 enemies (or deal 3% of a boss's HP) to rise at 40% HP, or die. Once a room (a boss: every quarter of its HP) | All healing −30% (Mate doses, Resta, regen, HP/Drain, Dark Flow) |
  | Dark Falz | III | Heart of Falz | Unit | Your other unique units' numbers are 50% stronger | So are their costs |

  The answers to one-shots are Rol Carapace (a cap), Tide Shell (a soak) and DF Shield (a second chance); the chain
  killers for Swarming rooms Flame Visit, Plague Mantle, Ophelie Seize and Soul Eater. Few costs are max HP, since Rol
  Carapace's cap would make them nearly free. Rules settled while building (my calls, open to change): Rol Carapace
  doesn't cap a failed boss mechanic (they must stay a must); Yasakani's echo skips Resta; S-Beat's Blade counts
  the third step perfect as the chain does; Dragon Rush hits once per enemy per dash.
  Rule notes from 2026-10-12: the Reactor Rod's "chain" is any attack cast within 1.5 s of the last; the Falz Halo's
  cost also stops pylon light; the Frozen Shooter's shatter thaws and makes the enemy immune for 3 s.
- **Estimates** (Damage tab, ▲ verdicts) count Red Ring crits, the Reactor Rod's ramp and the Frozen Shooter's
  rhythm; not the rift uniques' conditional effects (Rampage, Sword-Saint, combos). The item card lists the effect
  (green) and cost (red) under "Unique", for unique units too, and "You'd lose" names an equipped unique's.
- Old notes: the Seal of Light / Falz Halo pylon and Corruption affixes, the Warden Core's hazard affix and the
  bosses' signature drops all went with the old set. Venom (a special) is on no item now: poison comes from Venom
  Sac, Plague Mantle and Ophelie Seize (and Venom Edge, a dagger Art, until 2026-10-21).

## Crafting: Photons
First built 2026-10-11 (a Path of Exile-like system replacing grinding's race picks, with five photons and a
per-item **Potential** budget); **redesigned 2026-10-13** (the user's call) into fixed affix counts, dormant affixes
and three photons, with no budget (`crafting.ts`, `rollAffixes` in loot.ts, the `photon` item type). Kept from the
start: **the player picks every target**, as when typed grinders were rejected ("the drop would make the choice,
not the player").
- **What can be crafted:** weapons, frames and barriers that aren't uniques. Units are learned, not crafted.
- **Fixed counts:** a magic item has a prefix and a suffix; a rare 4 / 5 / 6 active affixes by item level (Normal /
  Nightmare from tier 8's / Hell and rifts from tier 12's), at most 3 of each kind (a 5 splits either way).
- **Dormant affixes:** a rare also rolls 1 / 2 / 3 **dormant** ones (so 9 on a Hell or rift rare), of any kind, from
  what its active ones left, at drop like the rest (value and strength tier). They do nothing until swapped in; the
  card lists them greyed under "Dormant".
- **Downsides:** every Hell and rift rare holds at least one, active or dormant (one of the prefixes it drew turns
  into one if none came up; about two thirds of rift armour drew one anyway). An active downside always has a plain
  dormant prefix to be swapped for. Barriers have only 5 prefixes, so their dormant ones lean to suffixes.
- **Photons** are a currency (2026-10-12): **picked up by walking over them** like Meseta and Rift Shards, one
  stack of each kind **up to 100**, and they **take no bag space**. A full stack leaves the photon lying there, said
  once per area. They work on **active** affixes only, as often as you have photons (Items tab > Photons > "Use
  on..." > item > pick):

  | Photon | Rarity | What it does |
  |---|---|---|
  | Photon Drop | common | Rerolls one affix's value within its strength tier (a downside's penalty too). Haste: 1% steps up to the item tier's cap. |
  | Photon Sphere | rare | One affix a strength tier up, up to what the item level allows (tier 6 on Hell, 7 from rift tier 4, 8 from rift tier 7); never comes out lower (at least +1). Haste +1 up to the cap. |
  | Photon Crystal | very rare | Swaps an active affix for a dormant one of the same kind (prefix for prefix, suffix for suffix); the player picks the pair. Both keep their rolls, so it can be swapped back. |

- **What stays a chase:** the base (line, gear tier, item level, a frame's unit slots) and the item's own 9 affixes:
  with photons enough, a drop becomes the best 6 of its 9 at the item level's top values. The verdict judges that
  fully crafted self too (2026-10-13, the user's ask; `bestCrafted`): every active set Crystals can reach (same
  prefix / suffix split), each affix at the top tier and value its item level allows (a downside may stay
  as it is), scored like the ▲ (damage / sec, then armour's rating) against what is worn. Affixes that add
  nothing are left out of the recipe. The pickup prompt adds a second line, "◆ Fully crafted: Damage/s +9% (1 Crystal
  · 3 Spheres · Drops)", green if that beats what is worn ("Even fully crafted: ..." grey if not), and the item card a
  second verdict row (its tooltip lists the swaps and maxed affixes). A drop that only beats what is worn crafted keeps
  its ▼ but isn't junk (nor sold or salvaged as junk). The worn piece is taken as it is, not crafted.
- **Strength tiers** are stored on rolls since crafting (`AffixRoll.t`); older rolls work theirs out from the value.
- **Supply:** drop rolls have a photon category (12 of 100). Normal tiers (1-7) drop only Photon Drops; Nightmare
  (8-11) 72 / 25 / 3 (Drop / Sphere / Crystal), Hell (12-15) 65 / 28 / 7, rifts 60 / 30 / 10. Nightmare bosses drop
  one photon, Hell bosses two, a rift's end two (a boss three).
- **Salvage junk** (shop, Sell tab): junk magic and rare gear (worse than what is worn; uniques stay) breaks into
  Photon Drops, one from each rare, one from a magic item 35% of the time. Normal junk is left to sell.
- **Old saves** (`upgradeCrafting`, on load): Null Photons become Spheres and Augment Cores Crystals; Potential and
  offers go; magic and rare gear is topped up to the fixed counts and rares get their dormant affixes (seeded by the
  uid; affixes they had stay).
- Debug panel: "give 5 of each photon"; the Lv 64 test characters carry some. Every number is a first draft.

## Deferred / Later Milestones
- More uniques (six so far), Falz Rifts' undecided parts (a Survey Board, pinnacle bosses, new base tiers), Section IDs, bank, tekker, guild quests, more enemy types (Rappy, Wolves,
  Mothmant/Monest, Hildebear, Shark family, Nano Dragon, Canadine drones, cloaking Sinows), gamepad support,
  ElevenLabs recordings for the Mines, Warden, Ruins and Dark Falz themes, a tier 7 injector and the new injector
  mods for Nightmare.
