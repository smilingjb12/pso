import GUI from 'lil-gui';
import { applyMix, mix } from '../audio';
import {
  attributeCfg,
  dash,
  ai,
  attackTypes,
  camera,
  casting,
  combo,
  comboAccuracy,
  comboDamage,
  debug,
  deRolLe,
  dragon,
  drops,
  elite,
  enemies,
  hazards,
  injectorCfg,
  telepipeCfg,
  panArms,
  statuses,
  feel,
  formulas,
  lockOn,
  magCfg,
  player,
  spellForms,
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
import type { AreaId } from '../game/data/areas';
import { weaponKinds } from '../game/data/items';

export interface DebugActions {
  giveXp(n: number): void;
  giveMeseta(n: number): void;
  giveWeapon(): void;
  giveRare(): void;
  heal(): void;
  killAll(): void;
  goto(area: AreaId): void;
  unlockCaves(): void;
  unlockMines(): void;
  unlockRuins(): void;
  unlockHard(): void;
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
    heal: () => actions.heal(),
    kill: () => actions.killAll(),
    city: () => actions.goto('city'),
    forest: () => actions.goto('forest1'),
    boss: () => actions.goto('dragon'),
    caves: () => actions.unlockCaves(),
    cave1: () => actions.goto('cave1'),
    cave2: () => actions.goto('cave2'),
    derolle: () => actions.goto('derolle'),
    mines: () => actions.unlockMines(),
    mine1: () => actions.goto('mine1'),
    mine2: () => actions.goto('mine2'),
    warden: () => actions.goto('warden'),
    ruins: () => actions.unlockRuins(),
    ruin1: () => actions.goto('ruin1'),
    ruin2: () => actions.goto('ruin2'),
    falz: () => actions.goto('falz'),
    hard: () => actions.unlockHard(),
  };
  g.add(act, 'heal').name('heal HP/TP');
  g.add(act, 'xp100').name('+100 EXP');
  g.add(act, 'xp1000').name('+1000 EXP');
  g.add(act, 'meseta').name('+5000 Meseta');
  g.add(act, 'weapon').name('give random weapon');
  g.add(act, 'rare').name('give random rare');
  g.add(act, 'kill').name('kill all enemies');
  g.add(act, 'city').name('warp: Pioneer 2');
  g.add(act, 'forest').name('warp: Forest 1');
  g.add(act, 'boss').name("warp: Dragon's lair");
  g.add(act, 'caves').name('unlock Caves');
  g.add(act, 'cave1').name('warp: Cave 1');
  g.add(act, 'cave2').name('warp: Cave 2');
  g.add(act, 'derolle').name('warp: De Rol Le');
  g.add(act, 'mines').name('unlock Mines');
  g.add(act, 'hard').name('unlock Nightmare');
  g.add(act, 'mine1').name('warp: Mine 1');
  g.add(act, 'mine2').name('warp: Mine 2');
  g.add(act, 'warden').name('warp: Warden');
  g.add(act, 'ruins').name('unlock Ruins');
  g.add(act, 'ruin1').name('warp: Ruin 1');
  g.add(act, 'ruin2').name('warp: Ruin 2');
  g.add(act, 'falz').name('warp: Dark Falz');

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

  const at = gui.addFolder('Attack types');
  for (const [name, t] of Object.entries(attackTypes)) {
    const f = at.addFolder(name);
    f.add(t, 'timingMult', 0.5, 3, 0.05).name('windup x');
    f.add(t, 'recoveryMult', 0.5, 3, 0.05).name('recovery x');
    f.add(t, 'damageMult', 0.1, 4, 0.01).name(name === 'light' ? 'damage x (per enemy)' : 'damage x');
    f.add(t, 'accuracyMult', 0.1, 2, 0.01).name('accuracy x');
    f.add(t, 'maxHit', 10, 100, 1).name('max hit %');
    f.close();
  }
  const ca = at.addFolder('combo accuracy');
  const accObj = comboAccuracy as unknown as Record<string, number>;
  comboAccuracy.forEach((_, i) => ca.add(accObj, String(i), 0.5, 3, 0.01).name(`hit ${i + 1}`));
  ca.close();
  const cd = at.addFolder('perfect streak damage');
  const dmgObj = comboDamage as unknown as Record<string, number>;
  comboDamage.forEach((_, i) => cd.add(dmgObj, String(i), 0.5, 3, 0.01).name(`streak ${i}`));
  cd.close();
  at.close();

  const sf = at.addFolder('spell forms');
  for (const [name, t] of Object.entries(spellForms)) {
    const f = sf.addFolder(name);
    f.add(t, 'timingMult', 0.5, 3, 0.05).name('cast time x');
    f.add(t, 'recoveryMult', 0.5, 3, 0.05).name('recovery x');
    f.add(t, 'powerMult', 0.1, 4, 0.01).name('power x');
    f.add(t, 'tpMult', 0.1, 4, 0.05).name('TP x');
    f.add(t, 'statusMult', 0, 4, 0.05).name('status chance x');
    f.close();
  }
  sf.close();

  const st = gui.addFolder('Stagger');
  st.add(stagger, 'light', 0, 3, 0.05).name('light (per enemy)');
  st.add(stagger, 'heavy', 0, 5, 0.1).name('heavy');
  st.add(stagger, 'rangedMult', 0, 2, 0.05).name('guns x');
  st.add(stagger, 'counterMult', 1, 4, 0.1).name('counter x (hit in windup)');
  st.add(stagger, 'decayDelay', 0, 5, 0.1).name('drain delay (s)');
  st.add(stagger, 'decayPerSec', 0, 5, 0.1).name('drain per s');
  st.close();

  const fm = gui.addFolder('Formulas');
  fm.add(formulas, 'damageDivisor', 1, 20, 0.1);
  fm.add(formulas, 'damageScale', 0.1, 3, 0.01);
  fm.add(formulas, 'evpFactor', 0, 1, 0.01).name('EVP factor (accuracy)');
  fm.add(formulas, 'enemyDamageScale', 0.05, 2, 0.01);
  fm.add(formulas, 'edgeAtpPct', 0, 0.2, 0.005).name('Edge ATP share / grind');
  fm.add(formulas, 'edgeMstPct', 0, 0.5, 0.01).name('Edge MST share / grind');
  fm.add(formulas, 'banePerGrind', 0, 20, 1).name('Bane race % / grind');
  fm.add(formulas, 'tpRegen', 0, 10, 0.1).name('TP regen /s');
  fm.add(formulas, 'meleeTpMult', 0, 5, 0.1).name('melee TP-on-hit mult');
  fm.close();

  const ts = gui.addFolder('Techniques (MST scaling)');
  ts.add(techScaling, 'mstRef', 20, 400, 1).name('reference MST');
  ts.add(techScaling, 'mstExp', 0.5, 2, 0.01).name('damage MST exponent');
  ts.add(techScaling, 'tpFloor', 0, 1, 0.01).name('TP cost floor');
  ts.add(techScaling, 'buffCap', 5, 100, 1).name('buff cap %');
  ts.add(techScaling, 'buffDuration', 5, 300, 5).name('buff duration (s)');
  ts.add(techScaling, 'statusPerMst', 0, 0.002, 0.0001).name('status chance / MST');
  ts.add(techScaling, 'burnMstDivisor', 5, 200, 1).name('burn: MST per +1 dmg');
  ts.close();

  const attrF = gui.addFolder('Attributes');
  attrF.add(attributeCfg, 'pointsPerLevel', 1, 6, 1).name('points per level');

  const mg = gui.addFolder('Mag');
  mg.add(magCfg, 'pointsPerLevel', 0.25, 3, 0.25).name('points per char level');
  mg.add(magCfg.keystoneReq[0], 'squares', 0, 40, 1).name('keystone I squares');
  mg.add(magCfg.keystoneReq[0], 'points', 0, 200, 5).name('keystone I attr points');
  mg.add(magCfg.keystoneReq[1], 'squares', 0, 40, 1).name('keystone II squares');
  mg.add(magCfg.keystoneReq[1], 'points', 0, 300, 5).name('keystone II attr points');
  mg.add(magCfg, 'hybridReqPoints', 0, 100, 5).name('two-arm notable points');
  mg.add(magCfg, 'bulwarkMult', 0.3, 1, 0.01).name('Bulwark dmg x');
  mg.add(magCfg, 'lastStandCooldown', 5, 600, 5).name('Last Stand cooldown');
  mg.add(magCfg, 'followThroughMult', 1, 2, 0.01).name('Follow-through x');
  mg.add(magCfg, 'breakerMult', 1, 3, 0.05).name('Breaker stagger x');
  mg.add(magCfg, 'crushDfpIgnore', 0, 1, 0.05).name('Crush DFP ignored');
  mg.add(magCfg, 'fleetCharges', 0, 3, 1).name('Fleet extra dashes');
  mg.add(magCfg, 'deadeyeMaxHit', 85, 100, 1).name('Deadeye heavy cap');
  mg.add(magCfg, 'rhythmBonus', 0, 0.2, 0.005).name('Rhythm +perfect s');
  mg.add(magCfg, 'rhythmRunMult', 1, 1.5, 0.01).name('Rhythm run speed x');
  mg.add(magCfg, 'efficiencyTpMult', 0.3, 1, 0.01).name('Efficiency TP x');
  mg.add(magCfg, 'injectorBoost', 0, 1, 0.05).name('Bulwark/Efficiency injector +');
  mg.add(magCfg, 'clarityTime', 0, 10, 0.5).name('Clarity free-cast s');
  mg.add(magCfg, 'swiftCastMult', 0.3, 1, 0.01).name('Swift Cast time x');
  mg.add(magCfg, 'steadfastKnockback', 0, 1, 0.05).name('Steadfast knockback x');
  mg.add(magCfg, 'slipstreamTime', 0.5, 10, 0.5).name('Slipstream window s');
  mg.add(magCfg, 'longshotMult', 1, 2, 0.01).name('Longshot dmg x');
  mg.add(magCfg, 'longshotRange', 2, 20, 0.5).name('Longshot range m');
  mg.add(magCfg, 'barrierCap', 0, 1, 0.05).name('Barrier cap (max HP)');
  mg.add(magCfg, 'barrierFade', 0.5, 15, 0.5).name('Barrier fade s');
  mg.add(magCfg, 'retaliateMult', 1, 2, 0.05).name('Retaliate dmg x');
  mg.add(magCfg, 'retaliateTime', 0.5, 6, 0.5).name('Retaliate window s');
  const ij = gui.addFolder('Injectors').close();
  ij.add(injectorCfg, 'chargePerEnemy', 0, 2, 0.05).name('Doses per enemy');
  ij.add(injectorCfg, 'fluidChargeMult', 0, 1, 0.05).name('Fluid charge rate x');
  ij.add(injectorCfg, 'eliteChargeMult', 1, 4, 0.25).name('Elite multiplier');
  ij.add(injectorCfg, 'calmRate', 0, 1, 0.01).name('Out of combat doses / s');
  ij.add(injectorCfg, 'calmDelay', 0, 20, 0.5).name('Out of combat delay (s)');
  ij.add(injectorCfg, 'useLock', 0, 1.5, 0.05).name('Use lock (s)');
  ij.add(injectorCfg, 'orbChance', 0, 0.3, 0.01).name('Orb chance / enemy');
  ij.add(injectorCfg, 'orbBoxChance', 0, 0.3, 0.01).name('Orb chance / crate');
  ij.add(injectorCfg, 'orbDoses', 0.25, 3, 0.25).name('Orb doses');
  ij.add(injectorCfg, 'orbLife', 5, 60, 1).name('Orb life (s)');
  ij.add(telepipeCfg, 'castTime', 0.5, 8, 0.25).name('Telepipe cast (s)');
  mg.close();

  const w = gui.addFolder('Weapon kinds');
  for (const wk of Object.values(weaponKinds)) {
    const f = w.addFolder(wk.label);
    f.add(wk, 'range', 0.5, 40, 0.1);
    if (!wk.ranged && !wk.lineWidth) f.add(wk, 'arcDeg', 10, 360, 1);
    if (wk.lineWidth) f.add(wk, 'lineWidth', 0.2, 5, 0.1);
    if (wk.spreadDeg) f.add(wk, 'spreadDeg', 0, 120, 1);
    f.add(wk, 'maxTargets', 1, 10, 1);
    f.add(wk, 'damageScale', 0.1, 3, 0.05);
    f.add(wk.timing, 'windup', 0.02, 1, 0.01);
    f.add(wk.timing, 'active', 0.02, 0.5, 0.01);
    f.add(wk.timing, 'recovery', 0.05, 1.5, 0.01);
    if (wk.ranged) f.add(wk, 'projSpeed', 5, 100, 1);
    f.add(wk, 'techBoost', 0.5, 2, 0.01);
    if (wk.tpOnHit !== undefined) f.add(wk, 'tpOnHit', 0, 10, 1).name('TP on hit');
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
    a.add(arch, 'hp', 1, 2000, 1);
    a.add(arch, 'atp', 0, 500, 1);
    a.add(arch, 'dfp', 0, 300, 1);
    a.add(arch, 'ata', 0, 300, 1);
    a.add(arch, 'evp', 0, 300, 1);
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
  d.add(dragon, 'hp', 100, 10000, 10).name('max HP (next spawn)');
  d.add(dragon, 'atp', 0, 500, 1);
  d.add(dragon, 'dfp', 0, 200, 1);
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
  drl.add(deRolLe, 'hp', 200, 20000, 50).name('max HP (next spawn)');
  drl.add(deRolLe, 'atp', 0, 600, 1);
  drl.add(deRolLe, 'dfp', 0, 300, 1);
  drl.add(deRolLe, 'plateMult', 0.05, 1, 0.05).name('damage through plates x');
  drl.add(deRolLe, 'maskHp', 50, 3000, 10).name('mask HP (next spawn)');
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
  wd.add(warden, 'hp', 200, 20000, 50).name('max HP (next spawn)');
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
  fz.add(darkFalz, 'hp', 1000, 40000, 100).name('max HP (next spawn)');
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
