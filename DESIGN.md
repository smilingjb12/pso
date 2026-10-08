# PSO-like (three.js) — Design Decisions

Living spec agreed during the kickoff interview. Gameplay first, graphics later.

## Scope — First Playable
- **Hub city** → teleporter → **Forest 1** (handcrafted, ~8–10 rooms) → **Dragon-style boss**.
  Expedition 2 (Caves → De Rol Le), Expedition 3 (Mines → Warden) and Expedition 4 (Ruins → Dark Falz) follow;
  see their sections below.
- Target run length for a fresh character: **~15–20 min**; each floor is a checkpoint (see Death & Saves).
- **Single-player only.** No networking plans.
- **Normal, Nightmare and Hell**, chosen at login, Diablo style (Nightmare opens after Dark Falz on Normal, Hell after it falls on Nightmare; see "Nightmare" and "Hell"). No Section IDs yet.

## Tech
- **TypeScript + Vite + three.js**.
- **lil-gui** debug panel for live-tuning combat numbers (timing windows, damage, accuracy, enemy stats).
- Game data (items, enemies, rooms, drop tables) lives in typed data files / JSON.
- Saves go to **localStorage** and autosave in the hub.

## Controls (keyboard + mouse only)
- WASD movement, mouse-orbit third-person camera.
- **Lock-on** (F / Tab) targets what the camera is looking at: the on-screen enemy closest to the middle of the view, never through walls (nearest enemy if none is on screen). While locked, Tab steps to the next enemy to the right. Attacks auto-face the target.
- A camera-reset key snaps the camera behind the player.
- **Action palette:** two rows, Shift swaps them. Each row has an attack source on the mouse (LMB = heavy
  single target, RMB = light area): **Weapon** swings the equipped weapon, **Magic** casts the selected attack technique (the mouse
  wheel cycles Foie / Zonde / Barta; a HUD chip shows the pick). Q and E are quick slots for the injector, items and
  support techniques (Resta, Shifta, Deband). The Vanguard and Ranger kits start with Weapon on row 1, the Mystic
  kit with Magic, and the palette editor (Menu → Palette) can swap them.
- **Key 1** always uses the injector (see Injectors).
- **Space + a direction** dashes (see Dash). Space alone does nothing until a direction is pressed while it is
  held; one dash per press. **R** is the interact key (talk, pick up, pull switches, break boxes; the context hex
  shows what it will do). Interact was split off Space (2026-10-07) so a panic dash next to a power switch or a
  drop never does the wrong thing.
- Menus (inventory, shop) **pause the game**, so nothing can be used from them: the inventory has no Use button.
  Consumables and injectors are used from the palette in real time.

## Combat — PSO-faithful
- **3-hit combo chain.** Each hit is Light or Heavy, and chaining needs **rhythm timing** (mashing breaks the chain).
- **Light hits an area, heavy hits one target.** Light: ×0.7 damage to every enemy in the weapon kind's shape (up
  to its target cap), 0.6 stagger each. Heavy: ×1.5 damage to the aimed enemy, a slower swing, 1.5 stagger,
  double knockback and the weapon special's roll (Heat, Ice, Shock, Draw, Dim, Venom; there is no separate
  special attack). Against a clustered pack light clears faster and safer; against one tough or spread-out
  enemy heavy wins.
- A **visual timing cue** (subtle flash/ring) marks the chain window.
- **Perfect window**: the first moments of the chain window (0.1 s by default). The ring lands gold, the weapon
  glints and the window-open tick sounds; pressing then is a perfect chain (chime, gold HUD pip). Perfect chains
  in a row build a streak that scales damage ×1.0 / ×1.15 / ×1.4. A later press in the window still chains but
  resets the streak to ×1.0.
- **Rhythm per weapon kind**: quick kinds (dagger, mechgun, wand, handgun) have a tight perfect window and
  short grace, slow kinds (sword, rod, rifle, partisan) wide ones; saber and cane use the defaults.
- Hits **roll accuracy** (player ATA vs enemy EVP) and can miss.
  - Heavy's hit chance is capped at 85%, so even high-ATA builds risk a miss.
  - Melee weapons get +15% hit. Guns lose 2.5% of their hit chance per metre past 10 m (rifles 18 m), down to half.
- **Melee pays for its risk.** Melee weapon damage ×1.1, ranged ×0.85.
- **Stagger meter** instead of a flinch roll: each hit adds points and the enemy flinches when they reach its
  poise (Booma 1, Gobooma 2, Gigobooma 3, Pan Arms 5, elites +1). Light adds 0.6 per enemy, heavy 1.5; gun hits
  count 0.75 ×. Finishers count double and a melee heavy finisher always staggers. Hits landing during a
  wind-up count double, and the meter drains after 1.2 s without hits.
- Combo accuracy rises 1.0 / 1.15 / 1.3 over the three hits (PSO's 1.69 is gone: the reward is now damage).
- Attacks commit you, and positioning is the defence. The **dash** is the way out, at a price.

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
  spent, the Telepipe breaks. So the choice is "finish the finisher, or get out?". Injectors can be used
  mid-dash (a dose is instant), and a dash cancels the drinking pose.
- A short **recovery** (0.15 s) after it blocks attacks and casts, so it is no free gap-closer. Walking and a
  second dash are fine.
- **Direction:** camera-relative WASD, and she turns to face it. **Locked on**, W / S close in or back off and
  A / D circle the target at the same distance, so it doubles as a strafe while she keeps facing it.
- Each dash **sheds one Burn stack** and counts as moving.
- A photon streak on the floor marks the path; `player.dash` sound (3 variants in the sound lab).
- Tuning panel: **Dash** folder. Two of the ideas became Mag passives (2026-10-08): **Fleet** (+1 charge) and
  **Slipstream** (dash out of a telegraph and the next attack or cast lands perfect). Still ideas: a no-dash keystone
  for purists, per-build flavour (Vanguard lunge, Ranger backstep, Mystic blink).

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
- **Weapon kinds differ by their light attack's shape**, plus speed, reach and rhythm. Every enemy caught rolls
  accuracy on its own and is hit once. Saber 110° arc, 3; Sword 160° sweep, 4; Dagger 90°, 2, two hits;
  Partisan line ahead, 4; Slicer piercing disc, 3; Handgun 3-shot fan, 2; Rifle piercing beam, 3; Mechgun
  5-round spray, 3 (heavy: a 3-round burst); Shot 5-pellet fan, 5; Cane 110°, 3; Rod 150°, 4; Wand 100°, 2.
  The weapon info panel shows each weapon's light / heavy line.
- **Melee weight classes** (agreed 2026-10-07, `config/` `weaponWeights`, `weaponKinds[].weight`). The user found
  the Sword unusable next to the Saber: it swung twice as slow for ~1.3x the damage per hit, missed more, staggered
  exactly like a Saber and lost its wind-up to every enemy hit (bot: Forest 220 s / 2.3 bars vs the Saber's 153 s /
  1.2). Speed was pure cost, so the slow kinds now get a payoff:
  - **Light** (Dagger, Wand): fastest swings, tight rhythm, low per-hit damage. Dagger ~1.25x a Saber on one target
    (trimmed from ~1.5x: damage scale 0.7 -> 0.6 per hit), weak on packs.
  - **Medium** (Saber, Cane): the baseline.
  - **Heavy** (Sword, Partisan, Rod): ~1.05 s swings (~1.4x a Saber; the Sword was 1.45 s) that hit harder per blow,
    **double stagger** (a light hit flinches any poise-1 enemy outright), step further (0.45 m light / 0.65 m heavy)
    and carry **Poise**: from the start of the swing until its strike ends, an enemy hit still does full damage (and
    gives the normal post-hit invulnerability) but doesn't flinch, knock back or cancel the swing. The recovery is
    still punishable. Not i-frames: nothing is avoided. The user picked Poise + stagger over stagger only.
  - Sword: wind-up 0.48 -> 0.32 s, recovery 0.85 -> 0.62, damage x1.05, ATA 15 -> 25 (rare swords +10 ATA to keep
    their edge). Partisan 0.30 / 0.10 / 0.64, damage x1.1 (reach 4.2 m outranges every enemy strike). Rod 0.30 /
    0.12 / 0.62, damage x1.1.
  - **Rod = the pure caster's weapon**: technique boost x1.2 (the Wand's old value) and the most MST; the **Wand**
    drops to x1.1 and keeps the fast swing-for-TP role (6 TP per hit); the Cane stays the hybrid (x1.05). Swapping
    the boosts keeps the best-case Force damage where it was. The tooltip now shows the boost.
  - The heavy attack's x1.55 wind-up and the rooted chain grace were left alone (the user declined both changes).
  - Bot check (Hunter, Light-Light-Heavy, never dodges): Forest Lv 7 tier 2, Saber 153 s / 1.2 bars, Sword 220 s /
    2.3 -> 153 s / 1.2, Partisan 191 s / 1.8 -> 158 s / 1.2, Dagger 141 s / 0.7. Cave 1 Lv 15 tier 3: Saber 189 s /
    3.0, Sword 264 s / 5.6 -> ~174 s / 2.5, Partisan 225 s / 3.9 -> 187 s / 3.5, Dagger 165 s / 1.7. The bot
    walks into reach with a Partisan, so its reach advantage doesn't show here.
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
  - Status chance gets +0.03% per MST; Burn ticks for 5 + MST / 40.
  - Fitted to keep a Force's damage close to the old curve (shop-rank disks). Measured heavy Foie, Force with a
    rod and Psy armor, no Mag MIND: 33 / 92 / 151 / 279 at Lv 1 / 12 / 22 / 42 (MST 64 / 144 / 217 / 363; the old
    system gave about 40 / 82 / 125 / 264). Lv 42 Hunter / Ranger (MST 56): heavy Foie 27, Resta 34 HP (5%),
    Shifta 4%. Light Foie casts per full TP bar go ~20 → ~33 over the game.
  - Old saves: learned levels are dropped and leftover disks refunded at their sell price. Drops: misc rolls are
    grinders only now (misc weight 7 → 3; the old disk share went to weapons 16 → 18 and armor 9 → 11; the
    grind rework later doubled misc to 6).
  - Next (agreed, not built): technique mods on canes / rods / wands and Psy armor, sidegrades in the spirit of
    injector mods (e.g. Foie splits into 3 fireballs, Zonde chains to 5, Barta leaves an ice field, Resta also
    cleanses), so Forces keep a loot chase. Advanced techs (Gi- / Ra- tiers, Megid): skipped for now.
- **Spell forms**: attack techniques have a light (area) and heavy (single target) form, like weapons. Foie:
  flame cone / homing fireball. Zonde: lightning chaining to 3 enemies / one big bolt. Barta: ice wave along a
  line / ice spike under one enemy. Light: ×0.5 power, normal TP, half status chance. Heavy: ×1.35 power,
  ×1.3 TP, ×1.5 status chance, a little slower to cast. Light wins per TP against three or more enemies.
- **Cast chains**: attack techniques chain like combo hits. Late in a cast's recovery a window opens; casting
  another attack tech there chains it (up to 3, the third with longer recovery), with the same perfect window,
  streak damage and too-early break. Resta and buffs only cast from idle and never chain.

## Character: no classes
Agreed 2026-10-07 and built 2026-10-08, after the user found the Mag grid full by Lv 60 with POW squares wasted on a
Force. Their calls: **remove classes** (you are your attributes, your Mag tree and your gear), attribute points
rather than tree squares that carry growth, **everything permanent**, and **old saves deleted**, not migrated.
- **Attributes** (`data/stats.ts`): every level after the first gives **3 points** (`attributeCfg.pointsPerLevel`)
  for **POW** (a point: ATP 0.9, ATA 0.1, HP 1.5), **DEX** (ATA 0.35, ATP 0.15, DFP 0.45, HP 1.5), **MIND** (MST 1,
  TP 1⅓) or **DEF** (DFP 1.7, HP 3.5), on top of a growth everyone shares (the lowest of the old classes in each
  stat: HP 7.5, TP 2, ATP 2.2, DFP 1.3, MST 1, ATA 1, EVP 2.2, LCK 0.3). Points spent like an old class grow
  exactly like it (to within 0.2 EVP a level): all MIND = the old Force, two POW to one DEF = the old Hunter, two
  DEX to one POW = the old Ranger (`progression.test.ts` checks it), so gear requirements and the tuning below
  still hold for those builds. **Base stats** = kit + shared growth + attributes (what Mag keystones and the
  Status screen's "base" use; equip requirements add the Mag).
- **Permanent:** no respec of attributes or Mag squares, ever. Bumping `BUILD_VERSION` (only when these rules
  change) refunds every point and square once, with a toast on load.
- **Starting kits** (`KITS`, picked at creation instead of a class): **Vanguard** (Saber, Mate, the old Hunter's
  Lv 1 stats), **Ranger** (Handgun, Mate, the old Ranger's) and **Mystic** (Cane, Fluid, the old Force's), each with
  its default palette. They lock nothing.
- **Title** = the attribute with the most points (the kit's on a tie): POW **Vanguard**, DEX **Ranger**, MIND
  **Mystic**, DEF **Guardian** (the user's names). It shows in the menu header, the slot list and the name plate,
  picks the outfit worn in a Standard frame (POW / DEF jacket, DEX coat, MIND robe) and the Mag's stage-1 form.
- **Gear** has no class lists: every weapon kind and armour line is gated by its stat requirement alone. Drops and
  shops lean (60%) toward the equipped weapon's stat: ATP blades and Guard armour, ATA guns and Combat, MST staves,
  Psy and Fluid injectors. Damage tables show the selected technique for builds led by MIND or holding a staff.
- **Saves:** the key moved to `pso-like-save-v2` (save `version` 4); the old key is deleted on first load, and
  every old-save migration went with it.
- Bot check (`.claude/simsetup.js` `mkChar` now spends points like the old class): Forest Lv 7 Hunter-like
  158 s / 1.2 bars, Ranger-like 169 s / 2.2; Cave 1 Lv 15 189 s / 3.3 and 226 s / 7.2; Mine 1 Lv 24 Hunter-like
  256 s / 3.9, all within run-to-run noise of the references. Hard Forest Lv 37 swings 330-545 s between runs with
  identical stats (champions), so compare paired runs there.
- Older notes in this file say Hunter / Ranger / Force for those builds.

## Loot & Progression — PSO-style
- XP curve + level-ups: stats come from the shared growth and attribute points (see "Character: no classes").
- Random drops with rarity tiers. Weapons roll **attribute %** (Native / A.Beast / Machine / Dark / Hit).
  Race % multiplies both weapon hits and attack-tech damage against that race (unlike PSO, so a Force's
  weapon attributes matter); Hit % only affects weapon accuracy. Because race % counts for everything, it
  rolls in 5% steps up to only 5 + 5 x tier (10% at tier 1, 45% at tier 8).
- **Races follow the expeditions** (2026-10-07, like PSO): Forest (Boomas, Dragon) **Native**, Caves **A.Beast**
  (except the Native lilies and the Dark De Rol Le), Mines **Machine**, Ruins (and Dark Falz) **Dark**. The Forest
  used to be A.Beast, which left Native % useful only against lilies.
- **Item names encode the rolls** (2026-10-07, the user's idea; `itemName` in `character.ts`, used everywhere
  incl. the ground prompt): `[prefix] Name [suffix] [+grind]`. The **prefix says what it does**: a rolled
  weapon special ("Heat Brand") or an injector mod ("Steady Star Fluid Injector"); a rare's fixed special is
  part of its identity and isn't prefixed. The **suffix says what it's for**: the best race % once it reaches
  half its tier's cap ("of Natives / Beasts / Machines / Darkness"; tier 8: 25%+), on rares too
  ("Red Saber of Machines"). From the Caves on, a half-cap race % is worth about a tier upgrade in its
  expedition, so the suffix means "beats the next tier here". Hit % and the exact numbers stay on the card.
  Planned caster tech mods will share the one prefix slot.
- **Weapon card** (menus and shops, 2026-10-07): only the item's own numbers (ATP / ATA / MST / Grind tiles;
  Special, Hit %, Req tags); what the kind does (reach, Poise, tech boost, TP on hit) is left out as
  known. Below it, a **damage per second** table by enemy race (`src/game/dps.ts`): the weapon's best 3-hit
  light / heavy mix on one enemy and, for casters, a chain of heavy casts of the selected technique, using the
  real Combo timings, accuracy and Mag passives against the average regular enemy of the current expedition
  (Nightmare-scaled). No crits, perfect chains, specials, buffs or TP. A weapon that isn't equipped shows the
  % change against the equipped one per cell, so "more MST vs. more A.Beast %" reads directly.
- **Drops on the ground** (`world/Pickup.ts`, `dropVerdict` in `character.ts`, 2026-10-07): the gem's colour is
  the type; **rares** are a purple cube with a purple pillar (and purple names in menus: red read as
  "can't use"); **grinders** get a silver pillar like their icon (scarce, always useful; purple stays rare-only). Each drop is judged against the character: **junk** (no stat better than what is
  worn) fades to a dull grey gem with no pulse; an equippable **upgrade** gets
  a green ▲ above it. An unmet requirement never makes an item junk (a locked upgrade stays plain). Rares never
  fade. Verdicts are re-read on a level-up, attribute or Mag point, equip or grind. The pickup prompt adds the
  inventory's mark and a note: "▲ ATP +14 · +Heat", "Downgrade: ATP −8", or in amber
  "Needs ATP 90 (you have 76) · ATP +38".
- **Supply boxes** open with the interact key (R, when within reach; the context hex shows a crate) and
  drop an item or Meseta. Attacks and techniques pass them by, so area attacks never waste hits on them.
- **Grinders: Edge or a race, chosen per level** (reworked 2026-10-07). Why: grinding was a no-decision
  resource ("apply to the best weapon"), and the caps (5 x tier, up to 50 on rares) never mattered: a clear
  dropped only ~2.4 (Forest) to ~3.4 (Caves, Mines) grind levels. Their calls: choose on apply (rejected typed
  grinders: the drop would make the choice, not the player), races **mixable per level**, and **no** strip /
  refund at the Tekker. Lower caps with bigger levels and more grinders was left to me.
  - **Caps** (`grindCap`): 5 levels at tiers 1-2, 6 at 3-4, 7 at 5-6, 8 at 7-8, 9 at tier 9; rares 2 more.
  - **Edge** (any level not on a race): +4% of the weapon's own average ATP (both ends) and ATA, and +15% of its
    MST on canes / rods / wands (`formulas.edgeAtpPct / edgeAtaPct / edgeMstPct`). A share of the weapon,
    not flat, so a level is ~3% damage at every tier and on light or heavy weapons alike (the old flat +2 ATP
    was ~4% at tier 1 but ~1% at tier 9, and half as much on a Sword as on a Saber).
  - **Race (Bane)**: +5% against one race per level (`banePerGrind`, one roll step), counted with the rolled
    % against the tier's roll cap (`raceCap`, 10% at tier 1 to 50% at tier 9). A good roll saves levels; a
    weapon rolled at the cap can't take more of that race. ~5-6% damage per level against that race, about
    2x an Edge level (fast low-ATP weapons like mechguns and daggers lean further toward races, as race %
    already did).
  - Races per expedition: Forest trash and the Dragon are **Native**; Caves trash ~70% A.Beast / 30% Native
    (Poison Lilies) with a **Dark** De Rol Le; Mines trash and the Warden are **Machine**; the Ruins and Dark Falz
    are all **Dark**. So the Caves is
    where mixing levels pays; the picker tags the race most enemies are ("here") and the boss's ("boss").
  - Data: `grind` stays the total (the "+N" in names), `bane` holds the race levels; Edge = total - races.
    Race % from Bane counts everywhere rolled % does (damage, the DPS table, names: "of Machines").
  - **Picker**: Items > grinder > "Use on weapon..." > weapon > one row per track (Edge, Native, A.Beast,
    Machine, Dark) with what it adds and the damage-per-second change against the current expedition's typical
    enemy (the selected technique for Forces). A Di- / Trigrinder puts all its levels on one pick; levels past
    a cap are lost, shown in amber ("+2 only, 1 lost") before you click. The weapon card adds a "Ground: Edge 1 ·
    Machine 2" tag.
  - **Supply**: misc drop weight 3 -> 6 (meseta 55 -> 52) and every boss drops two grinders, so a clear drops
    about one weapon's worth of levels of its tier (~5 Forest, ~7 Caves / Mines, more on Nightmare with elites).
    Pre-ground drops roll +1 (or +2) Edge.
- Stat requirements to equip check **base + Mag** stats; armor bonuses never count (so gear swaps can't unlock
  gear).
- **Armor lines**, gated like weapon kinds by a stat requirement alone (no classes since 2026-10-08): a neutral
  tier-1 starter, then **Guard** (req ATP: most DFP, little EVP, small ATP), **Combat** (req ATA: balanced DFP/EVP,
  biggest ATP + ATA) and **Psy** (req MST: low DFP, adds MST + TP), tiers 1-4. Requirements equal the line's stat
  for the old class that wore it at levels 6 / 12 / 20, so wearing another line needs attributes or a Mag built
  for it.
  Balance was checked with the combat bot (Forest, Lv 12, tier 3): Hunter Guard is safer and Combat ~6% faster;
  Ranger Combat beats Guard on both kill time and damage taken; a casting Force clears ~12% faster in Psy.
- **Mag** (`game/mag.ts`): every character has one (not an inventory item). It grows through a **talent grid**,
  not feeding (feeding was a chore, and the 5-feed bank threw progress away). **Each character level gives one
  point**; points never expire, and **every square is permanent** (click to learn; no respec). The grid is a
  diamond (**radius 7, 112 squares**, since 2026-10-08; radius 5 / 60 squares filled up by Lv 60 and every build
  ended the same) around the Mag at its centre, and a square can only be taken next to one already learned. Four
  arms: **POW** up (+3 ATP per square), **DEX** right (+2 ATA), **MIND** down (+3 MST), **DEF** left (+2 DFP), 22
  stat squares each (its axis and the wedge leaning toward it). Along each axis: a **notable** 3 out, **keystone
  I** 5 out and **keystone II** at the tip. Each diagonal has two half-and-half squares and a **two-arm notable**
  3 along it. At Lv 62 a build has about half the grid, so it has to choose; a specialist can push its own stat
  further than before (a full MIND arm is +74 MST, the old full grid +41) at the cost of the others.
  - **Requirements** (`magCfg.keystoneReq`, `hybridReqPoints`): keystone I needs 8 squares of its colour and 45
    points in its attribute, keystone II 16 squares and 115 points (hybrids count for both colours). Three points a
    level all in one attribute reach 45 at Lv 16 and 115 at Lv 39; two a level at Lv 23 / 58; half at Lv 31 / 78. So
    the deep keystones belong to builds that commit (the user's ask: MIND-heavy builds get the MIND keystones).
    Two-arm notables need 20 points in each of their attributes. Arm notables need nothing.
  - POW: Follow-through (finishers +15%) · **Breaker** (melee hits fill stagger 25% faster) · Crush (heavy
    **melee** attacks ignore 30% of enemy DFP).
  - DEX: **Fleet** (+1 dash charge) · Deadeye (heavy hit cap 95%, half the gun range falloff) · **Rhythm** (perfect
    window +0.03 s for combos and cast chains, and **10% faster running**; it no longer charges the injector).
  - MIND: Efficiency (attack techs cost 15% less TP; Fluid doses +20%) · Clarity (after a Fluid dose, attack
    techs cost no TP for 4 s) · **Swift Cast** (techniques cast 20% faster, wind-up and recovery, support included).
    Clarity replaced Siphon (TP per kill, no HP twin) and then Mind Shell (damage drained TP; rejected).
  - DEF: Bulwark (area attacks, boss attacks and hazards deal 15% less; Mate doses +20%) · **Steadfast** (every
    melee swing carries Poise like a heavy weapon; half knockback. The user accepted the overlap with heavy weapons)
    · Last Stand (a lethal hit leaves 1 HP and fires a free Mate dose; recharges after 120 s).
  - Two-arm: **Slipstream** (POW + DEX: dash out of an enemy telegraph and the next attack or cast within 3 s lands
    perfect, one more streak step) · **Longshot** (DEX + MIND: guns and techniques +12% past 8 m) · **Barrier**
    (MIND + DEF: Resta past full HP becomes a shield up to 20% of max HP that fades over 4 s; striped on the HP bar)
    · **Retaliate** (DEF + POW: after a hit, the next melee swing within 2 s deals +25%).
  The order is the user's (2026-10-08): Swift Cast last with Clarity before it, Deadeye as DEX keystone I with
  Fleet as the notable (kept after I warned it's a cheap must-have), Breaker and Crush melee only.
  Mag level = squares learned; it evolves at 5 (form by the leading attribute: Varuna POW, Kalki DEX, Vritra MIND,
  Bhima DEF), 15 and 25 (form by the arm with the most squares; ties go to the leading attribute), and at 40 splits
  into a mirrored **twin pair** (Ashvinau), one per shoulder. It floats behind the player's shoulder and also
  stands beside her on the character select pad. Glow stripes around its pod pulse in her palette accent colour
  while a point is unspent, and a level-up toast says so.
- Currency: **Meseta**. The one consumable is the **Telepipe**; injector refills are charge orbs (see Injectors).

## Injectors — HP / TP sustain
Agreed 2026-10-07, replacing stacks of mates and fluids. Stocking up on consumables made content trivial, while a
player deep in an expedition without them had no way back up; and the consumables crowded the 30-slot bag.
- **One equipment slot** (key 1, also assignable to Q / E) takes a **Mate** (HP) or a **Fluid** (TP) injector.
  The Vanguard and Ranger kits start with a Mate, the Mystic kit with a Fluid (Resta turns TP into HP); the mods are
  the real choice.
  (2026-10-07: it was two slots with generous recharge, and a player who didn't outlevel the content still never
  emptied the second one: a single Mate gave ~19 doses a floor against the 2-5 a dodging player needs.)
- Every injector holds **3 doses**; tiers differ in how much a dose restores: Mate 30 / 33 / 36 / 39 / 42% of max
  HP, Fluid 30 / 31 / 32 / 33 / 34% of max TP (TP pools grow faster than HP, and Resta turns TP into HP; the user
  asked for 30% on the first Fluid on 2026-10-08 as low levels ran dry, so tiers 2-4 were lifted to stay above it). There is
  no shared cooldown; a dose locks the hands for 0.45 s, and a hit cancels the lock, not the dose.
  (2026-10-07 nerf: a Lv 26 MST Force never ran dry with 5 × 50% Fluid doses that refunded ~40 TP per kill.)
- **Recharge comes from damage dealt**, not kills: the injector gains doses in proportion to the enemy HP the
  player removes (a normal enemy's whole bar = 0.15 doses; elites ×2; **Fluid injectors charge at half that rate**
  from every source). Bosses count the same way across their whole bar (Dragon 3 doses, De Rol Le 4.5, Warden 4.5,
  Dark Falz 5).
  Lava damage and re-formed Pan Arms halves give nothing. Only Pioneer 2 refills everything at once (no field
  refills since checkpoints went). A floor (~35 enemies) is worth about 3 + 5 Mate doses plus charge orbs.
- **Out of combat** (2026-10-08, the user: "very rough at lower levels at least"): with no room fight and no boss
  engaged, the injector refills **0.1 doses a second** (either kind, Fluid not halved) once **3 s** have passed since
  the fight (`injectorCfg.calmRate` / `calmDelay`, tuning panel **Injectors**): empty to full in about 30 s, so a
  fight can still drain it but walking on mostly tops it up. This reverses the earlier "nothing refills between
  fights" rule (and the one-dose trickle before that); the damage-based charge and orbs still decide mid-fight.
  (Recharge was 0.1 / enemy for a few hours on 2026-10-07; the user found it far too slow, so all damage-based
  sources went up by half.)
- **Requirements** only on tiers 3-5: Mate needs DFP 45 / 70 / 95, Fluid MST 80 / 115 / 150 (base + Mag, like
  gear). A MIND build can't run a strong Mate without DEF points or squares; a fighter can't run a strong Fluid.
- **Mods** (one per injector, about half of drops, two in every item shop): **Steady** (over 4 s, +60%),
  **Emergency** (+60% when the gauge is under 35%), **Reserve** (holds 4 doses instead of 3), **Absorbent** (charges 50%
  faster), **Sol** (also cures poison, paralysis and Burn, 4 s paralysis ward, usable while paralysed), **Bracing** (30%
  less damage for 3 s). Swapping injectors for a boss or a poison-heavy floor is the point.
- **Charge orbs** (2026-10-07, the user's idea, replacing Trimate / Trifluid): a glowing orb in the worn injector's
  colour that gives it **one full dose** (either kind, at full rate) when you **walk over it**, like meseta. No
  item, no key, no stockpile: a carried refill was an extra flask charge saved for later, and with one slot half
  of the Trimate / Trifluid drops were dead. Elites and champions always drop one, other enemies 4%, crates 3%
  (about 1.4 a floor plus elites); **bosses never** (their damage still charges the injector). While the injector
  is full (or none is worn) the orb dims and stays; it blinks and fades after 25 s, so it's a mid-fight pickup,
  not a bank to walk back to. Rebooting gunbots drop none. Bosses drop the old Trimate / Trifluid value in Meseta.
- Shops sell tier 1 and the two best tiers on sale (clean), plus two modded ones. Injectors drop as their own
  loot category; healing left the drop table, so gear drops a little more often.
- The HUD shows the injector beside the gauges: one cell per dose, the next one filling as you fight.

## Telepipe
- A **3.5 s cast** that roots you; a hit, a step or a dash breaks it (the pipe isn't used up), so it is no escape from a
  boss. It opens a **portal** where you stand. The portal leads to Pioneer 2 and stays open; a matching portal
  appears by the city teleporter and leads back to the spot, then both close. One Telepipe open at a time; a new
  expedition closes it. Dying keeps it open, which is the way back to where you fell.
- Cast from a Q / E quick slot, or from the inventory (Items → Telepipe → **Use**, 2026-10-08, the user's ask): the
  menu closes and the cast is already running, under the same rules.

## Death & Saves — PSO-like
- Death costs no Meseta. The only option is returning to Pioneer 2 (no Moon Atomizer or Scape Doll): come back
  through an open Telepipe, or through the city teleporter.
- **Floors are the checkpoints** (2026-10-07, their design; checkpoint pads removed). Each expedition keeps its own
  run this session (`Game.runs`): the furthest floor reached, boss arena included, and the rooms cleared on each
  floor. The city teleporter has one row per expedition with a progress tag ("2/3 · Cave 2") and takes you to that
  floor's start; cleared rooms stay cleared. Their calls: progress lives for the session only (not saved, like PSO;
  logging out starts every expedition fresh), several expeditions can hold progress at once, there is **no field
  refill** (only Pioneer 2), and **no manual reset**: only killing the boss completes the run, after which the row
  starts again at floor 1. Taking a floor teleporter deeper closes a Telepipe left open in that expedition (it
  would lead behind you). Cave 2 and Mine 2 have a teleporter to Pioneer 2 where their checkpoint pads were.

## Level Design — Forest 1
- Handcrafted **room graph** defined in data, with rooms connected by corridors.
- **Laser-fence gates** lock rooms until the enemy waves are cleared.
- One or two switch/key puzzles. The layout is the same every run.

## Enemies (first playable)
- **Booma family:** Booma → Gobooma → Gigobooma (stat/behaviour tiers). Native, like the Dragon.
  Melee brawlers with slow, clearly telegraphed swipes. Wave composition varies the mix.
- **Boss — Dragon-style:** arena fight with phases: ground stomps, fire-breath cone, burrow phase,
  head/belly weak point. The eruption out of the burrow is the game's first **dash check** (see Dash checks);
  enraged stomps hit 7 m instead of 6.

## Hub
- **Shops:** weapon, armor, item. Buy/sell, with partly random stock that scales with level.
- (Deferred: bank, tekker, guild quests.)

## Saving
- **Autosave** (character only: level, XP, items, Meseta, techniques, palette, appearance, stats). The
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
  **equipped frame** decides them (`armorLook`, `playerLook`), like a Mag evolving. The frame's line picks the
  outfit: Guard (melee) = Ranger jacket, Combat (ranged) = Coat & knit, Psy (caster) = Force robe; a Standard
  frame (or none) gives the leading attribute's outfit (POW / DEF jacket, DEX coat, MIND robe). Its tier picks an **evolution stage** (`TIER_STAGE`): T1 = 0,
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
  Colours step so the glow colour can be judged. Previews: **`/armorlab.html`** (all lines, or one line from
  the front and from behind; optional Mag to check clutter), sheets in `armor-previews/`.
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
  reflections and bloom for areas that have a look; Forest, Dragon, De Rol Le and Pioneer 2 are unchanged.

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
- `src/game/combo.ts`: 3-hit combo state machine (unit-tested).
- `src/game/data/`: stats, attributes and starting kits (`stats.ts`), items (weapon kinds × tiers, rares, armor, injectors, consumables,
  grinders), techniques (MST scaling), area layouts.
- `src/game/character.ts`: persistent character, inventory, equipment rules, grinding, technique cost / damage, XP.
- `src/game/mag.ts`: Mag talent grid, passives, points, requirements, evolution forms; `models/mag.ts` is its model.
- `src/game/injectors.ts`: injector stats, mods, charge and doses (unit-tested in `injectors.test.ts`).
- `src/game/loot.ts`: drop tables, weapon attributes/specials, injector rolls, shop stock.
- `src/game/world/`: level builder (rooms + corridors + laser gates; forest, lair, cave and river dressing),
  room waves (pinned spawns, ambushes, overlap), Pan Arms pairs, hazards, cosmetic effects, pickups, boxes,
  projectiles, telegraphs, interactables.
- `src/game/enemies/`: `Enemy` base + `Brawler` (Booma family), cave AIs (`caveEnemies.ts`), Mines machines
  (`mineEnemies.ts`), Ruins enemies (`ruinsEnemies.ts`), factory (`spawn.ts`), the `Boss` interface, Dragon
  (`Dragon.ts`), De Rol Le (`DeRolLe.ts`), the Warden (`Warden.ts`) and Dark Falz (`DarkFalz.ts`).
- `src/game/world/Pylon.ts`: the Ruins' light pylons.
- `src/game/world/Machinery.ts`: crushers, laser fences and conveyors (Mines).
- `src/game/combat/Combat.ts`: hit resolution for melee, guns and techniques, statuses, incoming damage.
- `src/game/Game.ts`: loop, areas and the expedition run state, menus, death, saving.
- `src/game/models/`: procedural rigs and models (humanoid, booma, dragon, cave enemies, De Rol Le, Mines machines
  and the Warden in `mines.ts`, weapons, props).
- `src/viewer.ts` + `viewer.html`: standalone model viewer; `runlab` and `charlab` pages compare run cycles and character looks; `maglab` compares Mag designs (`src/game/models/magDesigns.ts`); `armorlab` shows the armour evolutions.
- `src/ui/`: HUD, menus (inventory, shop, dialogs), lil-gui tuning panel. `title.ts`: title screen (save
  slots, the selected character on a teleporter pad rendered by `MenuStage.ts`) and the 6-step creation
  wizard (kit, body, hair, face gear, colours, name). `src/menus.css`: PSO Dreamcast-style windows used by every
  menu, the pause window, prompts and toasts.
- `src/audio/`: engine (context, buses, reverb), `synth.ts` primitives, `sfx.ts` catalogue, `picks.ts` /
  `levels.ts` (chosen variants and loudness trims), `music/` (instruments, theory helpers, tracks, sequencer).
  `src/game/audioCues.ts` turns field-enemy and lava-vent state changes into sounds; bosses, combat, the game
  and the menus call `sfx()` directly. `soundlab.html` + `src/soundlab.ts`: the Sound Lab.
- `src/devHarness.ts`: dev-only `window.__h` for scripted playtests (fixed-step `run`, combat `bot`).
  `.claude/simsetup.js` adds balance-sim helpers (`mkChar`, `simRooms`, damage-by-source) for the browser console.

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
- **Poison marsh**: elliptical pools that poison you and slow you to 70%. Natives ignore them. Lilies sit behind
  them.

### Waves
- Wave entries can pin an enemy to a tile (`{ e, tx, tz }`), which is how Lilies end up behind hazards.
- `ambush: [i]`: wave *i* drops in behind the player through 1 s blue circles.
- `overlap: true`: the next wave starts once a third (or less) of the current one is left.

### Boss — De Rol Le (`enemies/DeRolLe.ts`, `models/derolle.ts`)
- **Arena**: a 10 × 30 m raft. Water, foam, mist and canyon walls scroll past while the raft stays still.
  The worm is a head plus 8 segments that follow the head's swim trail. Parts under water can't be hit.
- **Phase 1**: each segment's shell plate passes 30% of damage to the boss until it breaks. The mask works the
  same way (950 HP, ×1.5 while the head rests). Breaking the mask, or dropping the boss to 50%, shatters the
  shell and starts **phase 2** (+15% damage taken, faster, shorter gaps).
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
- Machines are plain fights; the weapon's **Machine** attribute % is what matters (no plating or weak points).
- **Gillchic** (gunbot): closes to ~9 m (never backs off, so melee can catch it), telegraphs a line shot (0.95 s),
  swipes with its pincer up close. The one gunbot type; node links make the difference.
- **Garanz** (artillery tank): walks slowly, **plants** (it can't turn) and fires a 5-missile barrage at where you
  stand; missiles only reach targets in front of it. Missile blasts also hurt other machines (12% max HP) and
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
    (every one in phase 2) adds a **Repair Drone** (160 HP, high EVP, up to 2) that flies to a corner post by
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
  Hyper Cannon, Quasar Mace, Monolith, Aurora Staff; reqs ATP 185 / ATA 150 / MST 230) and armour line (Bastion,
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
- Tuned for **Lv 32–42**; every enemy is **Dark** (Dark % and Dark grinding finally pay).
- Normal elites (1 in 12) roll **Shielding** or **Regenerating** (`RUINS_AFFIXES`; the Mines roll Overclocked /
  Volatile).

### Corruption (player status)
- Each stack takes **6% of max HP** away, up to **5** (−30%); current HP drops with it and heals fill only to the
  lowered max. It wears off by itself after a while (below); **pylon light** (or a Grants pool) sheds one stack a
  second, and a **cleared room**, a **Sol** dose, a boss kill or Pioneer 2 clear it all.
- Only attacks that **telegraph in violet** corrupt (on Hell any landed hit may; see "Hell") (a melee windup that corrupts heats up violet, not orange): So
  Dimenian cuts (50%), Chaos Sorcerer spells, the Dark Belra slam, Chaos Bringer lasers, Dark Falz's husk pulse, the
  Angel's halves and Megid orbs (two stacks).
- HUD: the HP bar keeps its full width and the lost share shows as a cracked violet block at its right end; a chip
  reads `CORRUPT ×n · LIGHT` (the hint goes once you stand in light).
- **Seal of Light** (Dark Falz signature barrier) and **Falz Halo** (its Nightmare twin) halve what Corruption takes.
- **Corruption wears off by itself** (2026-10-08, with Hell; all difficulties). Every application, even at the cap,
  resets a shared **30 s** timer (`statuses.corruptDuration`); when it runs out, the stacks shed one every **2 s**
  (`corruptWearTime`), so there is no sudden +30% HP refill. Pylons, Grants pools, cleared rooms, Sol, boss kills and
  Pioneer 2 still clean it faster. The HUD chip shows the timer (`CORRUPT ×3 · 24s`, then `FADING`, or `LIGHT`).

### Light pylons (`world/Pylon.ts`)
- 1–2 per room (`pylons` in the room data), solid obelisks with a crystal. **R lights one**: a **5 m** circle for
  **10 s**, then **20 s** to recharge (a ring fills; the prompt counts down). A faint inlaid ring on the floor shows
  each pylon's reach even while dark.
- Inside the light: Corruption sheds, and **Dark enemies are slowed (tempo ×0.7) and take +25% damage** (Dark Falz
  too, if it stands in one). Luring pays.
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
  fires, Darvants streaking along them; a **ring dive** (a 3.2 m circle on you, Darvants spiralling in); stand
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
  expedition HP / XP / Meseta multipliers and flat ATP / DFP / ATA / EVP additions (multiplying ATP would widen the
  gap between grunts and brutes too much): Forest HP ×6.8, ATP +240; Caves ×4.7, +280; Mines ×2.9, +255; Ruins ×2.6,
  +270 (before the shift: Forest ×6 / +195, Caves ×3.4 / +190, Mines ×2.2 / +165). XP multipliers keep the levelling
  pace for the higher bands (22 / 5.7 / 3.4 / 3). Boss adds (the Warden's Spark Mites and Repair Drones) get the
  Mines scaling.
- **No XP falloff** for being above a band: Hard is where the XP is, but levelling anywhere stays allowed.
- Techniques scale with MST only (no disks since 2026-10-07; see Loot & Progression), so a Force keeps growing
  through MST from levels, Mag and Hard-tier gear. (At Lv 82, the top of the bands, a build has 81 of the Mag tree's 112 squares.)

### Tempo: busier, not shorter
- Recoveries and attack cooldowns ×0.8, movement ×1.1: enemies attack more often.
- Telegraphs only ×0.9 and never pushed below 0.8 s (one already shorter stays as it is), so the readability
  pass on the Mines isn't undone.

### Elites, champions and affixes
- **Elites everywhere** on Hard (the Forest included), 1 in 4 spawns (was 1 in 8 until a 2026-10-07 retune): **one affix** from the whole pool.
- **Looks** (agreed 2026-10-07): the floor glow only marks rank (violet elite, gold champion). Each affix has its own
  effect on the body (`enemies/affixFx.ts`), placed so a champion's two don't overlap, so you can read it without
  the enemy frame: Overclocked cyan sparks over the body and speed streaks behind it; Volatile an orange core glow
  that throbs faster as it weakens, smoke on top; Shielding teal rings orbiting the waist (a hex plate in front once
  alone) and a wireframe hex bubble on each ally it protects; Regenerating green motes spiralling up (grey while
  suppressed), a green flash and a "+N" when it or an ally heals; Splitting a yellow seam down its middle that
  widens as it weakens; Molten a charred body glowing through its cracks, embers and drips; Stormcaller a storm cloud
  over its head with lightning into it; Frenzied steam venting as it nears 40%, then red flames and 10% bigger.
- **Champions:** each room has a 60% chance of one (never a control node), **two affixes**, gold aura and a gold
  enemy frame, ×2 HP and ×1.15 ATP (an elite is ×1.6 / ×1.25), ×4 XP, two bonus drops with tripled rare odds and a
  25% chance at a tier 6 injector. Normal keeps today's elites (Caves plain, Mines Overclocked / Volatile).
- **Affix pool** (all expeditions on Hard). Reworked 2026-10-07 to be harder (the user's calls; the same rules
  apply to Normal Mines elites). The combat bot never dodges, so these are tuned by playing (`affixes` in config):
  - **Overclocked** (cyan): ×1.5 movement and attack speed, and every attack is followed at once by one more (the
    attack token is kept; `Enemy.followUp`): a swing with a 0.6× windup, another Lily spit, Migium circle or gunbot
    shot, a second Garanz stomp (never a second barrage), one more Sinow finisher before its backflip.
  - **Volatile** (orange): while you are within ~3.6 m it vents a 2.6 m blast around itself every 4 s (0.9 s warning,
    adds Burn). Its death blast is 3.8 m and leaves burning ground for 4 s.
  - **Shielding** (teal): tethers up to 3 allies within 8 m; they take 70% less damage. While it has allies it hangs
    back 2.5 m behind them (away from you) instead of fighting, unless you reach it. Alone, it takes 60% less
    damage from hits in front of it (a 140° arc).
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
    combined with Overclocked), hits 30% harder and can't be staggered or stunned (freezing still works).
  Considered and left out: Insulated (half technique damage) and Frost aura (slow).
- **Enemy frame:** a coloured chip per affix under the name, nothing more (2026-10-07: the first-time description
  lines and the "[LOCK]" tag were removed; the lock-on reticle already shows the lock).

### Bosses
- HP ×13.5 / ×7.8 / ×2.45 / ×2.4 and ATP +375 / +345 / +320 / +310 (Dragon / De Rol Le / Warden / Dark Falz; before
  the shift ×9 / ×6.5 / ×1.9 and +330 / +300 / +270). Flat damage (breath and beam ticks, the laser wall, burning
  zones) ×3.2 / ×2.4 / ×1.9; mask and shell plates scale with HP. The Warden's Repair Drones
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
  245 / 275 / 305 / 335, ATA 180 / 195 / 210 / 225, MST 290 / 320 / 350 / 380; armour reqs at the line's class stat for
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
- **Level bands:** Forest 82–92, Caves 92–102, Mines 102–112, Ruins 112–122. `MAX_LEVEL` went from 100 to 130.
- **Same maps and waves.** Field enemies scale per expedition the Nightmare way, carrying on about one band per
  expedition from the Nightmare Ruins with HP growing a little less steeply (~×1.15 a band instead of ~×1.25):
  Forest HP ×15.2 / ATP +569, Caves ×7.7 / +577, Mines ×5.2 / +551, Ruins ×4.3 / +545 (DFP about +165-170, ATA
  about +220, EVP about +130). Tempo is Nightmare's. XP ×56 / 21 / 9.6 / 5.7 keeps roughly 24 regular kills a level
  (elites and champions make it faster). No XP falloff.

### Every enemy corrupts
- On Hell any landed enemy or boss hit (melee strikes and area attacks, not beam ticks) corrupts at **30%**
  (`hell.corruptChance`; `Combat.hellCorrupt`, set when an area loads); attacks that already corrupt (violet)
  don't roll twice. It is a trait of the difficulty, not an affix, so elites and champions keep their full affixes.
- With Corruption wearing off by itself, no pylons are added outside the Ruins. Expect to sit near the cap in
  long fights: the hit chance and the % per stack are the tuning knobs.

### More affixes
- Elites: **40%** of spawns in the Hell Forest, 48% Caves, 56% Mines, **65%** Ruins (`hell.<exp>.elite`;
  Nightmare: 25%), one affix from the whole pool as on Nightmare.
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
- **Rolls on dropped weapons, frames and barriers** from **tier 11** (the Nightmare Ruins) up, on 75% of them,
  1% up to the tier's cap: T11 3%, T12 5%, T13 7%, T14 9%, T15 12% (`hasteCfg`); what is worn adds up (~9% at the
  end of Nightmare, ~36% at the top of Hell; 25% cancels Nightmare's enemy recovery ×0.8). Shop stock never has it.
  Shown on the item card ("Haste +7%"), in the compare table and the pickup note; not in the name.
- Weight classes keep their gap: Haste multiplies a heavy weapon's already longer timings.

### Loot
- **Tiers 12–15** of every weapon kind (Galaxy Saber ... Omega Saber), armour line and barrier (Sovereign Frame /
  Phantom Frame / Oracle Garment ... Imperator Frame / Phoenix Frame / Archon Garment), carrying on each table's
  steps: weapon reqs ATP 365-455, ATA 240-285, MST 410-500; armour reqs at the line's class stat for Lv 84 / 92 / 100 / 108.
  Hell enemies drop the top three tiers up to their expedition's (Forest T10–12 ... Ruins T13–15).
- **No Hell rares or signature drops yet** (an empty rare pool never rolls one). Hell bosses drop their tier
  twice over instead: two weapons and two armour pieces of the top two tiers, a modded tier 6 injector, three
  grinders and 30k / 40k / 52k / 66k Meseta.
- Shops stock tier 12 / 13 / 14 / 15 from Lv 92 / 102 / 112 / 122 once the matching Hell boss is dead.

### Bosses
- Built 2026-10-08 (one agent per boss, each checked with scripted rolls: the safe spot is picked first and the
  rest built around it; every roll left exactly one safe pocket, reachable on foot in time, and a walker following
  it took no hits while standing still always got hit). Hell bosses scale the Nightmare way: HP ×23.6 / 13 / 4 / 3.6
  and ATP +530 / +540 / +540 / +520 (Dragon / De Rol Le / Warden / Dark Falz), flat damage ×5.4 / 3.9 / 2.95 / 2.7,
  XP 8500 / 13800 / 17600 / 22400 (`hell.bosses`, whose `hell: true` opens what follows).
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
  - **Eclipse** (first one says "The dark swallows the altar: only the light is safe"): the safe Grants pillar lands
    4–6.5 m from you (5–11 m from the centre), two more at ±120° round the altar; they land at 1.3 s and leave light.
    At 2.8 s both halves go dark at once (violet, corrupting) and anyone in a light pool is spared; feathers fire with
    the dark, fanned so the two other pools have no gap. Walk to the near pool, step in when its pillar lands.
  - **Judgement**: the altar splits and your half goes violet; a 100° feather wing covers the far quarter of the
    other half and a 7 m lance runs from the Angel across it. All fire at 2.1 s (×0.8 enraged). Safe: the near
    quarter of the other half, past the lance.
- Numbers in each boss's block of `config/bosses.ts` (`phase3At` / `hellPhaseAt`, `tripleEvery`, the windups and
  widths). Smoke test (bot, HP lowered): all four reach the Hell phase, Nightmare bosses never show more than their pairs.

### Balance reference (bot, never dodges; `.claude/simsetup.js` SETUPS hXF / rXF / hXC / hXM / hXR, last arg 'hell')
- Each band entered with the band-before's gear and no Haste: Hell Forest Hunter Lv 86 tier 11: 375-500 s /
  8.8-12 bars (Nightmare Forest Lv 44 tier 7 for comparison: 348 s / 5.7). Hell Cave 1 Lv 96 tier 12: 366 s / 8.2.
  Hell Mine 2 Lv 106 tier 13: 503 s / 8.3. Hell Ruin 2 Lv 116 tier 14 (before ×4.55 / +570 was cut to ×4.3 / +545):
  rooms s1-s4 610 s / ~16 bars, and the bot couldn't finish s5 (it can't pin down a blinking Overclocked Chaos
  Sorcerer; the Sorcerer does take damage). Nightmare Ruin 2 Lv 76 for comparison: 726 s / 14.4.
  About 50-80 Corruption stacks taken per run (the sim counts them instead of applying them).
- Bars count damage against true max HP: Corruption's lowered max isn't in them, so Hell is harder than they say.

## Deferred / Later Milestones
- Hell rares and signature drops (Hell has none yet), Section IDs, Mag photon blasts (planned as grid keystones), bank, tekker, guild quests, more enemy types (Rappy, Wolves,
  Mothmant/Monest, Hildebear, Shark family, Nano Dragon, Canadine drones, cloaking Sinows), gamepad support,
  ElevenLabs recordings for the Mines, Warden, Ruins and Dark Falz themes, a tier 7 injector and the new injector
  mods for Nightmare.
