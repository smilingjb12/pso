import GUI from 'lil-gui';
import { applyMix, mix } from '../audio';
import {
  dash,
  ai,
  basicAttack,
  camera,
  casting,
  combo,
  comboDamage,
  debug,
  deRolLe,
  dragon,
  drops,
  elite,
  enemies,
  hazards,
  injectorCfg,
  panArms,
  statuses,
  feel,
  formulas,
  lockOn,
  magCfg,
  passiveCfg,
  skillCfg,
  player,
  stagger,
  techScaling,
  affixes,
  machinery,
  nodes,
  warden,
  weaponWeights,
  darkFalz,
  pylonCfg,
  ruinsCfg,
} from '../game/config';
import { areas, expeditions, type AreaId, type ExpeditionId } from '../game/data/areas';
import { weaponKinds } from '../game/data/items';
import type { TestClass } from '../game/testCharacters';
import { riftCfg } from '../game/rifts';

export interface DebugActions {
  giveXp(n: number): void;
  giveMeseta(n: number): void;
  giveWeapon(): void;
  giveRare(): void;
  giveUnit(): void;
  /** Five of each photon (crafting). */
  givePhotons(): void;
  heal(): void;
  killAll(): void;
  goto(area: AreaId): void;
  /** Open an expedition (every boss before it counts as beaten). */
  unlock(exp: ExpeditionId): void;
  unlockHard(): void;
  unlockHell(): void;
  /** Save a premade Lv 64 character (Hell open) into the first empty slot. */
  testCharacter(cls: TestClass): void;
  /** Falz Rifts: put shards in the stash, open more tiers, or go straight into a rift (Hell rules, any session). */
  riftShards(n: number): void;
  riftMoreTiers(n: number): void;
  riftOpen(boss: boolean): void;
}

export function createDebugPanel(actions: DebugActions): GUI {
  const gui = new GUI({ title: 'Tuning  ( ` to toggle )', width: 310 });

  const au = gui.addFolder('Audio').close();
  au.add(mix, 'master', 0, 1, 0.05).onChange(applyMix);
  au.add(mix, 'music', 0, 1, 0.05).onChange(applyMix);
  au.add(mix, 'sfx', 0, 1, 0.05).onChange(applyMix);

  const g = gui.addFolder('Debug');
  g.add(debug, 'timeScale', 0.05, 1.5, 0.05).name('time scale');
  g.add(debug, 'showLog').name('combat log');
  g.add(debug, 'invincible');
  const act = {
    xp100: () => actions.giveXp(100),
    xp1000: () => actions.giveXp(1000),
    meseta: () => actions.giveMeseta(5000),
    weapon: () => actions.giveWeapon(),
    rare: () => actions.giveRare(),
    unit: () => actions.giveUnit(),
    photons: () => actions.givePhotons(),
    heal: () => actions.heal(),
    kill: () => actions.killAll(),
    hard: () => actions.unlockHard(),
    hell: () => actions.unlockHell(),
    ranger: () => actions.testCharacter('ranger'),
    hunter: () => actions.testCharacter('hunter'),
  };
  g.add(act, 'heal').name('heal HP/TP');
  g.add(act, 'xp100').name('+100 EXP');
  g.add(act, 'xp1000').name('+1000 EXP');
  g.add(act, 'meseta').name('+5000 Meseta');
  g.add(act, 'weapon').name('give random weapon');
  g.add({ xpLv: () => actions.giveXp(1e7) }, 'xpLv').name('+10M EXP (levels)');
  g.add(act, 'rare').name('give rare item (your level)');
  g.add(act, 'unit').name('give random unit');
  g.add(act, 'photons').name('give 5 of each photon');
  g.add(act, 'kill').name('kill all enemies');
  g.add(act, 'hard').name('unlock Nightmare');
  g.add(act, 'hell').name('unlock Hell');
  g.add(act, 'ranger').name('new Lv 64 Ranger (empty slot)');
  g.add(act, 'hunter').name('new Lv 64 Hunter (empty slot)');
  g.add({ city: () => actions.goto('city') }, 'city').name('warp: Pioneer 2');
  for (const exp of Object.values(expeditions)) {
    if (exp.needs) g.add({ unlock: () => actions.unlock(exp.id) }, 'unlock').name(`unlock ${exp.name}`);
    for (const id of exp.floors) g.add({ warp: () => actions.goto(id) }, 'warp').name(`warp: ${areas[id].name}`);
  }

  const rf = gui.addFolder('Rifts').close();
  rf.add({ s: () => actions.riftShards(5) }, 's').name('give 5 Rift Shards');
  rf.add({ t: () => actions.riftMoreTiers(10) }, 't').name('open 10 more rift tiers');
  rf.add({ o: () => actions.riftOpen(false) }, 'o').name('enter a rift (Guardian)');
  rf.add({ o: () => actions.riftOpen(true) }, 'o').name('enter a rift (boss)');
  rf.add(riftCfg, 'hpPerTier', 1, 1.3, 0.005).name('HP x per tier');
  rf.add(riftCfg, 'dmgPerTier', 1, 1.2, 0.005).name('damage x per tier');
  rf.add(riftCfg, 'armorPerTier', 0, 3, 0.05).name('armour % + per tier');
  rf.add(riftCfg, 'techResistPerTier', 0, 3, 0.05).name('tech resist % + per tier');
  rf.add(riftCfg, 'capTier', 1, 40, 1).name('tempo / resist stop at tier');
  rf.add(riftCfg, 'elite', 0, 1, 0.01).name('elite share');
  rf.add(riftCfg, 'bossChance', 0, 1, 0.01).name('boss chance');
  rf.add(riftCfg, 'guardianShard', 0, 2, 0.05).name('Guardian shard odds');
  rf.add(riftCfg, 'championShard', 0, 0.5, 0.01).name('champion shard odds');
  rf.add(riftCfg, 'yellow', 0, 1, 0.05).name('yellow shard share');

  const c = gui.addFolder('Combo timing');
  c.add(combo, 'windowOpen', 0.2, 1, 0.01).name('window opens at (swing %)');
  c.add(combo, 'grace', 0, 0.5, 0.01).name('grace after swing (s)');
  c.add(combo, 'earlyPress', ['break', 'ignore']).name('early press');
  c.add(combo, 'resetDelay', 0, 1, 0.01).name('reset delay (s)');
  c.add(combo, 'finisherRecoveryMult', 1, 3, 0.05).name('finisher recovery x');
  c.add(combo, 'perfect', 0, 0.4, 0.005).name('perfect window (s)');
  c.add(combo, 'showCue').name('show timing cue');
  c.close();

  const cst = gui.addFolder('Casting');
  cst.add(casting, 'recoveryMult', 0, 3, 0.05).name('tech recovery x');
  cst.add(casting, 'resetDelay', 0, 1, 0.01).name('cooldown after cast (s)');
  cst.add(casting, 'windowOpen', 0.2, 1, 0.01).name('chain window opens at (cast %)');
  cst.add(casting, 'grace', 0, 0.5, 0.01).name('chain grace (s)');
  cst.add(casting, 'perfect', 0, 0.4, 0.005).name('perfect window (s)');
  cst.add(casting, 'finisherRecoveryMult', 1, 3, 0.05).name('3rd cast recovery x');
  cst.close();

  const at = gui.addFolder('Basic attack');
  at.add(basicAttack, 'damageMult', 0.1, 4, 0.01).name('damage x (per enemy)');
  at.add(basicAttack, 'tpRefill', 0, 0.3, 0.005).name('TP refill (share of base TP)');
  at.add(basicAttack, 'finisherTp', 1, 4, 0.1).name('finisher TP x');
  at.add(basicAttack, 'perfectTp', 1, 4, 0.1).name('perfect TP x');
  at.add(basicAttack, 'boltRange', 4, 25, 0.5).name('photon bolt range');
  const cd = at.addFolder('perfect streak damage');
  const dmgObj = comboDamage as unknown as Record<string, number>;
  comboDamage.forEach((_, i) => cd.add(dmgObj, String(i), 0.5, 3, 0.01).name(`streak ${i}`));
  cd.close();
  at.close();

  const st = gui.addFolder('Stagger');
  st.add(stagger, 'light', 0, 3, 0.05).name('light (per enemy)');
  st.add(stagger, 'heavy', 0, 5, 0.1).name('heavy');
  st.add(stagger, 'rangedMult', 0, 2, 0.05).name('guns x');
  st.add(stagger, 'counterMult', 1, 4, 0.1).name('counter x (hit in windup)');
  st.add(stagger, 'decayDelay', 0, 5, 0.1).name('drain delay (s)');
  st.add(stagger, 'decayPerSec', 0, 5, 0.1).name('drain per s');
  st.close();

  const fm = gui.addFolder('Formulas');
  fm.add(formulas, 'critDamage', 1, 4, 0.05).name('crit damage x');
  fm.add(formulas, 'meleeDamageMult', 0.5, 3, 0.01).name('melee damage x');
  fm.add(formulas, 'rangedDamageMult', 0.5, 3, 0.01).name('ranged damage x');
  fm.add(formulas, 'enemyDamageScale', 0.05, 2, 0.01);
  fm.add(formulas, 'edgeAtpPct', 0, 0.2, 0.005).name('Edge weapon damage share / grind level (built in)');
  fm.add(formulas, 'edgeMstPct', 0, 0.5, 0.01).name('Edge tech damage share / grind level (built in)');
  fm.add(formulas, 'refineArmorPct', 0, 0.2, 0.005).name('Armour bonus share / grind level (built in)');
  fm.add(formulas, 'tpRegen', 0, 10, 0.1).name('TP regen /s');
  fm.close();

  const ts = gui.addFolder('Techniques (tech damage scaling)');
  ts.add(techScaling, 'mstRef', 20, 400, 1).name('reference tech damage');
  ts.add(techScaling, 'damageMult', 0.1, 3, 0.01).name('attack tech damage x');
  ts.add(techScaling, 'debandShare', 0, 1, 0.01).name('Deband share off damage taken');
  ts.add(techScaling, 'tpFloor', 0, 1, 0.01).name('TP cost floor');
  ts.add(techScaling, 'buffCap', 5, 100, 1).name('buff cap %');
  ts.add(techScaling, 'buffDuration', 5, 300, 5).name('buff duration (s)');
  ts.add(techScaling, 'statusPerMst', 0, 0.002, 0.0001).name('status chance / tech damage');
  ts.add(techScaling, 'burnShare', 0, 1.5, 0.05).name('burn: share of hit');
  ts.add(techScaling, 'chillMult', 0.3, 1, 0.05).name('chill: speed');
  ts.close();

  const mg = gui.addFolder('Mag').close();
  mg.add(magCfg, 'pointsPerLevel', 0.25, 3, 0.25).name('points per char level');

  mg.add(magCfg, 'pbChargePerEnemy', 0, 0.3, 0.005).name('photon blast gauge per enemy');
  mg.add(magCfg, 'pbBossCharge', 0, 3, 0.05).name('photon blast gauge per boss');
  mg.add(magCfg, 'pbMyllaMult', 0, 20, 0.5).name('Mylla & Youlla x');

  const sk = gui.addFolder('Skills').close();
  sk.add(skillCfg, 'artBasePower', 0.5, 1.2, 0.01).name('Art power at rank 1');
  sk.add(skillCfg, 'artPowerPerRank', 0, 0.15, 0.005).name('Art power per rank');
  sk.add(skillCfg, 'artTpPerRank', 0, 0.05, 0.005).name('Art TP off per rank');

  // Every numeric passive setting, live (passives.ts reads them when it describes or applies a passive).
  const tf = gui.addFolder('Passives').close();
  for (const [k, v] of Object.entries(passiveCfg)) {
    if (typeof v !== 'number') continue;
    const max = v === 0 ? 1 : v < 1 ? 1 : v <= 3 ? 4 : v <= 20 ? v * 3 : v * 2;
    tf.add(passiveCfg, k as keyof typeof passiveCfg, 0, max, v < 1 ? 0.01 : v <= 3 ? 0.05 : 1).name(k);
  }
  const ij = gui.addFolder('Injectors').close();
  ij.add(injectorCfg, 'chargePerEnemy', 0, 2, 0.05).name('Doses per enemy');
  ij.add(injectorCfg, 'fluidChargeMult', 0, 1, 0.05).name('Fluid charge rate x');
  ij.add(injectorCfg, 'eliteChargeMult', 1, 4, 0.25).name('Elite multiplier');
  ij.add(injectorCfg, 'calmDelay', 0, 20, 0.5).name('Out of combat delay (s)');
  ij.add(injectorCfg, 'useLock', 0, 1.5, 0.05).name('Use lock (s)');
  mg.close();

  const w = gui.addFolder('Weapon kinds');
  for (const wk of Object.values(weaponKinds)) {
    const f = w.addFolder(wk.label);
    f.add(wk, 'range', 0.5, 40, 0.1);
    if (!wk.ranged) f.add(wk, 'arcDeg', 10, 360, 1);
    if (wk.spreadDeg) f.add(wk, 'spreadDeg', 0, 120, 1);
    f.add(wk, 'maxTargets', 1, 10, 1);
    f.add(wk, 'damageScale', 0.1, 3, 0.05);
    f.add(wk.timing, 'windup', 0.02, 1, 0.01);
    f.add(wk.timing, 'active', 0.02, 0.5, 0.01);
    f.add(wk.timing, 'recovery', 0.05, 1.5, 0.01);
    if (wk.ranged) f.add(wk, 'projSpeed', 5, 100, 1);
    f.add(wk, 'techBoost', 0.5, 2, 0.01);
    if (wk.tpRefill !== undefined) f.add(wk, 'tpRefill', 0, 3, 0.1).name('TP refill x');
    if (wk.boltPower !== undefined) f.add(wk, 'boltPower', 0, 3, 0.05).name('bolt power');
    f.close();
  }
  const ww = w.addFolder('Weight classes');
  for (const [name, wc] of Object.entries(weaponWeights)) {
    const f = ww.addFolder(name);
    f.add(wc, 'staggerMult', 0.5, 4, 0.1).name('stagger x');
    f.add(wc, 'lunge', 0, 1.5, 0.05).name('lunge light (m)');
    f.add(wc, 'lungeHeavy', 0, 1.5, 0.05).name('lunge heavy (m)');
    f.add(wc, 'poise').name('Poise');
    f.close();
  }
  ww.close();
  w.close();

  const p = gui.addFolder('Player feel');
  p.add(player, 'moveSpeed', 1, 15, 0.1);
  p.add(player, 'turnSpeed', 1, 40, 0.5);
  p.add(player, 'attackTurnSpeed', 0, 40, 0.5).name('aim turn during windup');
  p.add(player, 'hitstun', 0, 1.5, 0.01);
  p.add(player, 'iframes', 0, 2, 0.01);
  p.add(player, 'knockback', 0, 20, 0.5);
  p.close();

  const dsh = gui.addFolder('Dash');
  dsh.add(dash, 'charges', 1, 5, 1);
  dsh.add(dash, 'recharge', 0.5, 15, 0.1).name('recharge per charge (s)');
  dsh.add(dash, 'distance', 1, 8, 0.1).name('distance (m)');
  dsh.add(dash, 'duration', 0.08, 0.6, 0.01).name('duration (s)');
  dsh.add(dash, 'recovery', 0, 0.6, 0.01).name('no-attack recovery (s)');
  dsh.add(dash, 'burnShed', 0, 5, 1).name('Burn stacks shed');
  dsh.add(dash, 'cueTelegraphs').name('rim on boss dash checks');
  dsh.close();

  const f = gui.addFolder('Feel');
  f.add(feel, 'hitstopNormal', 0, 0.2, 0.005);
  f.add(feel, 'hitstopHeavy', 0, 0.3, 0.005);
  f.add(feel, 'hitstopPlayerHurt', 0, 0.3, 0.005);
  f.add(feel, 'shakeOnHit', 0, 0.5, 0.01);
  f.add(feel, 'shakeOnHurt', 0, 0.8, 0.01);
  f.add(feel, 'enemyKnockback', 0, 15, 0.5);
  f.close();

  const cam = gui.addFolder('Camera / Lock-on');
  cam.add(camera, 'distance', 2, 15, 0.1);
  cam.add(camera, 'height', 0, 4, 0.1);
  cam.add(camera, 'sensitivity', 0.0005, 0.01, 0.0001);
  cam.add(lockOn, 'range', 4, 30, 0.5).name('lock range');
  cam.add(lockOn, 'softAimDeg', 0, 180, 1).name('melee soft aim angle');
  cam.add(lockOn, 'softAimRange', 0, 10, 0.1).name('melee soft aim range');
  cam.add(lockOn, 'rangedSoftAimDeg', 0, 90, 1).name('gun soft aim angle');
  cam.add(lockOn, 'rangedSoftAimRange', 0, 40, 0.5).name('gun soft aim range');
  cam.add(lockOn, 'cameraFollow', 0, 15, 0.1).name('lock cam follow');
  cam.close();

  const e = gui.addFolder('Enemies');
  e.add(ai, 'maxThreat', 1, 6, 1).name('threat budget (live attacks)');
  e.add(ai, 'barrageThreat', 1, 4, 1).name('Garanz barrage share');
  e.add(ai, 'attackStagger', 0, 2, 0.05).name('min gap between attacks (s)');
  e.add(ai, 'shotGap', 0, 3, 0.05).name('min gap between shots (s)');
  e.add(ai, 'waveDelay', 0, 5, 0.1).name('delay between waves (s)');
  for (const arch of Object.values(enemies)) {
    const a = e.addFolder(arch.name);
    a.add(arch, 'hp', 1, 10000, 1);
    a.add(arch, 'atp', 0, 500, 1);
    a.add(arch, 'armor', 0, 80, 1).name('armour %');
    a.add(arch, 'moveSpeed', 0, 12, 0.1);
    a.add(arch, 'windup', 0.1, 2, 0.01).name('windup (telegraph)');
    a.add(arch, 'strikeActive', 0.05, 0.6, 0.01);
    a.add(arch, 'recovery', 0, 3, 0.01).name('recovery (punish window)');
    a.add(arch, 'strikes', 1, 4, 1);
    a.add(arch, 'attackCooldown', 0, 5, 0.05);
    a.add(arch, 'strikeRange', 0.5, 6, 0.1);
    a.add(arch, 'strikeArcDeg', 10, 360, 1);
    a.add(arch, 'poise', 0.5, 8, 0.5).name('poise (hits to flinch)');
    a.add(arch, 'hitstun', 0, 1.5, 0.01);
    a.add(arch, 'xp', 0, 500, 1);
    a.add(arch, 'dropRate', 0, 1, 0.01);
    a.close();
  }
  e.close();

  const d = gui.addFolder('Dragon');
  d.add(dragon, 'hp', 500, 50000, 10).name('max HP (next spawn)');
  d.add(dragon, 'atp', 0, 500, 1);
  d.add(dragon, 'armor', 0, 80, 1).name('armour %');
  d.add(dragon, 'moveSpeed', 0, 10, 0.1);
  d.add(dragon, 'stompWindup', 0.2, 3, 0.05);
  d.add(dragon, 'breathWindup', 0.2, 3, 0.05);
  d.add(dragon, 'breathDuration', 0.2, 5, 0.1);
  d.add(dragon, 'breathTickDamage', 0, 100, 1);
  d.add(dragon, 'chargeWindup', 0.2, 3, 0.05);
  d.add(dragon, 'chargeSpeed', 2, 40, 0.5);
  d.add(dragon, 'burrowEvery', 5, 120, 1);
  d.add(dragon, 'eruptWindup', 0.3, 3, 0.05);
  d.add(dragon, 'eruptRadius', 1, 10, 0.1).name('erupt radius (dash check)');
  d.add(dragon, 'enragedStompRadius', 2, 12, 0.1).name('enraged stomp radius');
  d.add(dragon, 'stunDuration', 0.5, 10, 0.1).name('weak point window (s)');
  d.add(dragon, 'weakPointMult', 1, 4, 0.05);
  d.add(dragon, 'enrageAt', 0, 1, 0.05);
  d.add(dragon, 'attackGap', 0, 5, 0.05);
  d.close();

  const drl = gui.addFolder('De Rol Le');
  drl.add(deRolLe, 'hp', 1000, 100000, 50).name('max HP (next spawn)');
  drl.add(deRolLe, 'atp', 0, 600, 1);
  drl.add(deRolLe, 'armor', 0, 80, 1).name('armour %');
  drl.add(deRolLe, 'plateMult', 0.05, 1, 0.05).name('damage through plates x');
  drl.add(deRolLe, 'maskHp', 250, 20000, 10).name('mask HP (next spawn)');
  drl.add(deRolLe, 'phase2At', 0.1, 0.9, 0.05).name('phase 2 at HP %');
  drl.add(deRolLe, 'attackGap', 0.5, 6, 0.1).name('gap between attacks (P1)');
  drl.add(deRolLe, 'attackGap2', 0.5, 6, 0.1).name('gap between attacks (P2)');
  drl.add(deRolLe, 'bombWindup', 0.4, 3, 0.05);
  drl.add(deRolLe, 'bombRadius', 0.5, 4, 0.1);
  drl.add(deRolLe, 'slamWindup', 0.5, 3, 0.05);
  drl.add(deRolLe, 'slamWindup2', 0.5, 3, 0.05).name('slamWindup2 (dash check)');
  drl.add(deRolLe, 'slamWidth', 2, 10, 0.1);
  drl.add(deRolLe, 'ringRadius', 1.5, 6, 0.1).name('bomb ring radius');
  drl.add(deRolLe, 'ringBombs', 4, 14, 1).name('bomb ring count');
  drl.add(deRolLe, 'slamRest', 0.5, 5, 0.1).name('lying on deck (s)');
  drl.add(deRolLe, 'beamWindup', 0.5, 3, 0.05);
  drl.add(deRolLe, 'beamSweep', 1, 6, 0.1);
  drl.add(deRolLe, 'beamTickDamage', 0, 80, 1);
  drl.add(deRolLe, 'headRest', 0.5, 6, 0.1).name('head rest (weak point, s)');
  drl.add(deRolLe, 'sprayWindup', 0.5, 3, 0.05);
  drl.add(deRolLe, 'puddleLife', 2, 30, 1);
  drl.close();

  const cv = gui.addFolder('Caves');
  cv.add(elite, 'chance', 0, 1, 0.01).name('elite chance');
  cv.add(elite, 'hpMult', 1, 4, 0.05).name('elite HP x');
  cv.add(elite, 'atpMult', 1, 3, 0.05).name('elite ATP x');
  cv.add(panArms, 'reformAfter', 1, 20, 0.5).name('Pan Arms re-form (s)');
  cv.add(panArms, 'mergeAfter', 3, 40, 0.5).name('Pan Arms merge (s)');
  cv.add(statuses, 'poisonPctPerSec', 0, 0.1, 0.005).name('poison HP %/s');
  cv.add(statuses, 'paralysisDuration', 0.2, 5, 0.1).name('paralysis (s)');
  cv.add(statuses, 'paralysisImmunity', 0, 10, 0.5).name('paralysis ward (s)');
  cv.add(hazards, 'ventPeriod', 2, 15, 0.1).name('vent cycle (s)');
  cv.add(hazards, 'ventWarning', 0.3, 4, 0.05).name('vent warning (s)');
  cv.add(hazards, 'ventDamage', 0, 300, 1);
  cv.add(hazards, 'ventEnemyPct', 0, 1, 0.05).name('vent dmg to enemies (% HP)');
  cv.add(hazards, 'marshSlow', 0.2, 1, 0.05).name('marsh speed x');
  cv.close();

  const wd = gui.addFolder('Warden');
  wd.add(warden, 'hp', 1000, 200000, 50).name('max HP (next spawn)');
  wd.add(warden, 'atp', 0, 700, 1);
  wd.add(warden, 'phase2At', 0, 1, 0.05).name('phase 2 at HP %');
  wd.add(warden, 'attackGap', 0.3, 6, 0.1).name('attack gap (s)');
  wd.add(warden, 'attackGap2', 0.3, 6, 0.1).name('attack gap phase 2 (s)');
  wd.add(warden, 'patternWindup', 0.3, 4, 0.05).name('pattern wave warning (s)');
  wd.add(warden, 'patternWindup2', 0.3, 4, 0.05).name('pattern warning phase 2 (s)');
  wd.add(warden, 'patternWaves', 1, 8, 1).name('pattern waves');
  wd.add(warden, 'patternWaves2', 1, 8, 1).name('pattern waves phase 2');
  wd.add(warden, 'ventTime', 0, 8, 0.1).name('core vent (weak point, s)');
  wd.add(warden, 'ventMult', 1, 4, 0.05).name('vent damage x');
  wd.add(warden, 'wallWindup', 0.3, 4, 0.05).name('wall warning (s)');
  wd.add(warden, 'wallTime', 1, 10, 0.1).name('wall crossing (s)');
  wd.add(warden, 'wallGap', 1, 12, 0.1).name('wall gap (m)');
  wd.add(warden, 'wallDamage', 0, 300, 1);
  wd.add(warden, 'lockWindup', 0.3, 4, 0.05).name('lockdown warning (s)');
  wd.add(warden, 'lockMax', 1, 12, 1).name('lockdown zones before reset');
  wd.add(warden, 'lockHold', 0, 30, 0.5).name('reset after cap (s)');
  wd.add(warden, 'lockTick', 0, 120, 1).name('zone damage / 0.5 s');
  wd.add(warden, 'slamRange', 2, 20, 0.5).name('slam range (m)');
  wd.add(warden, 'slamWindup', 0.3, 4, 0.05).name('slam warning (s)');
  wd.add(warden, 'slamWindup2', 0.3, 4, 0.05).name('slam warning phase 2 (s)');
  wd.add(warden, 'slamRadius', 1, 8, 0.1).name('slam radius (m)');
  wd.add(warden, 'intakePull', 0, 5, 0.1).name('intake pull (m/s)');
  wd.add(warden, 'intakePull2', 0, 5, 0.1).name('intake pull phase 2 (m/s)');
  wd.add(warden, 'intakeTime', 0.5, 6, 0.1).name('intake (s)');
  wd.add(warden, 'summonMites', 0, 6, 1).name('mites per summon');
  wd.add(warden, 'maxDrones', 0, 4, 1).name('max repair drones');
  wd.add(warden, 'droneHealPct', 0, 0.03, 0.001).name('drone heal (max HP %/s)');
  wd.close();

  const mn = gui.addFolder('Mines');
  mn.add(affixes, 'overclockedTempo', 1, 2, 0.05).name('Overclocked speed x');
  mn.add(affixes, 'volatileRadius', 1, 6, 0.1).name('Volatile blast radius');
  mn.add(affixes, 'volatileWindup', 0.3, 3, 0.05).name('Volatile fuse (s)');
  mn.add(nodes, 'rebootAfter', 0.5, 15, 0.5).name('gunbot reboot (s)');
  mn.add(nodes, 'rebootHp', 0.05, 1, 0.05).name('gunbot reboot HP %');
  mn.add(statuses, 'burnPctPerStack', 0, 0.03, 0.001).name('burn HP %/s per stack');
  mn.add(statuses, 'burnMaxStacks', 1, 10, 1).name('burn max stacks');
  mn.add(statuses, 'burnStackTime', 0.5, 10, 0.1).name('burn stack life (s)');
  mn.add(statuses, 'burnMoveMult', 1, 8, 0.1).name('burn shed while moving x');
  mn.add(machinery, 'crusherPeriod', 2, 12, 0.1).name('crusher cycle (s)');
  mn.add(machinery, 'crusherWarning', 0.3, 3, 0.05).name('crusher warning (s)');
  mn.add(machinery, 'crusherDamage', 0, 400, 1);
  mn.add(machinery, 'laserOn', 0.3, 6, 0.1).name('laser on (s)');
  mn.add(machinery, 'laserOff', 0.3, 6, 0.1).name('laser off (s)');
  mn.add(machinery, 'laserDamage', 0, 300, 1);
  mn.add(machinery, 'conveyorSpeed', 0, 6, 0.1).name('conveyor speed');
  mn.close();

  const ru = gui.addFolder('Ruins');
  ru.add(statuses, 'corruptPctPerStack', 0, 0.2, 0.005).name('corruption max HP % / stack');
  ru.add(statuses, 'corruptMaxStacks', 1, 10, 1).name('corruption max stacks');
  ru.add(statuses, 'corruptLightTime', 0.2, 5, 0.1).name('light sheds a stack every (s)');
  ru.add(pylonCfg, 'radius', 1, 10, 0.1).name('pylon light radius (m)');
  ru.add(pylonCfg, 'litTime', 1, 30, 0.5).name('pylon lit (s)');
  ru.add(pylonCfg, 'recharge', 1, 60, 0.5).name('pylon recharge (s)');
  ru.add(pylonCfg, 'enemySlow', 0.2, 1, 0.05).name('light: Dark tempo x');
  ru.add(pylonCfg, 'enemyDamage', 1, 2, 0.05).name('light: Dark damage taken x');
  ru.add(pylonCfg, 'snuffTime', 0.2, 5, 0.1).name('Sorcerer snuff (s)');
  ru.add(ruinsCfg, 'guardMult', 0, 1, 0.01).name('Delsaber guard: light hit x');
  ru.add(ruinsCfg, 'guardDown', 0, 10, 0.1).name('Delsaber guard down (s)');
  ru.add(ruinsCfg, 'blinkRange', 0, 10, 0.1).name('Sorcerer blinks inside (m)');
  ru.add(ruinsCfg, 'chargeWindup', 0.3, 3, 0.05).name('Bringer charge warning (s)');
  ru.add(ruinsCfg, 'chargeSpeed', 4, 25, 0.5).name('Bringer charge speed (m/s)');
  ru.close();

  const fz = gui.addFolder('Dark Falz');
  fz.add(darkFalz, 'hp', 5000, 300000, 100).name('max HP (next spawn)');
  fz.add(darkFalz, 'atp', 0, 800, 1);
  fz.add(darkFalz, 'form2At', 0, 1, 0.05).name('form 2 at HP %');
  fz.add(darkFalz, 'form3At', 0, 1, 0.05).name('form 3 at HP %');
  fz.add(darkFalz, 'openTime', 0, 8, 0.1).name('husk open (s)');
  fz.add(darkFalz, 'laneWindup', 0.3, 4, 0.05).name('lane warning (s)');
  fz.add(darkFalz, 'ringWindup', 0.3, 4, 0.05).name('ring warning (s)');
  fz.add(darkFalz, 'grantsWindup', 0.3, 4, 0.05).name('Grants warning (s)');
  fz.add(darkFalz, 'grantsLight', 0, 10, 0.5).name('Grants light lasts (s)');
  fz.add(darkFalz, 'megidSpeed', 0.5, 6, 0.1).name('Megid orb speed (m/s)');
  fz.add(darkFalz, 'slamWindup', 0.3, 4, 0.05).name('teleport slam warning (s)');
  fz.add(darkFalz, 'slamRadius', 1, 8, 0.1).name('teleport slam radius (m)');
  fz.add(darkFalz, 'halfWindup', 0.3, 4, 0.05).name('halves warning (s)');
  fz.add(darkFalz, 'halfFlip', 0.3, 4, 0.05).name('halves flip (s)');
  fz.add(darkFalz, 'lanceWindup', 0.3, 4, 0.05).name('lance warning (s)');
  fz.add(darkFalz, 'lanceWidth', 1, 12, 0.1).name('lance width (m)');
  fz.close();

  const dr = gui.addFolder('Drops');
  dr.add(drops, 'rateMult', 0, 5, 0.1).name('drop rate x');
  dr.add(drops, 'rareMult', 0, 100, 0.5).name('rare rate x');
  dr.add(drops, 'boxDropRate', 0, 1, 0.05);
  dr.close();

  return gui;
}
