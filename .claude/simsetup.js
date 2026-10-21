// Dev playtest helpers for the browser pane (paste into javascript_tool after a reload).
// Not loaded by the game. Defines mkChar / goRoom / simRooms / dmgBy on window.
(async () => {
  const { Character, makeItem } = await import('/src/game/character.ts');
  const { xpToNext } = await import('/src/game/data/stats.ts');
  const { grantArts } = await import('/src/game/skills.ts');
  const g = window.__h.game;
  // passives (optional): passive ids granted at full rank, and every Art open at the level at rank 4 (no points, no prerequisites); Mag points stay unspent.
  window.mkChar = (lvl, weapon, frame, barrier, passives = []) => {
    const ch = Character.create('Tester');
    let xp = 0;
    for (let l = 1; l < lvl; l++) xp += xpToNext(l);
    ch.addXp(xp);
    grantArts(lvl, ch.data.skills, 4);
    passives.forEach((id) => id && (ch.data.skills.ranks[id] = 5));
    for (const [slot, id] of [['weapon', weapon], ['frame', frame], ['barrier', barrier]]) {
      if (!id) continue;
      const it = makeItem(id);
      ch.data.inventory.push(it);
      ch.data.equipped[slot] = it.uid;
    }
    ch.data.stats.dragonKills = 1;
    ch.data.stats.deRolLeKills = 1;
    ch.data.stats.wardenKills = 1;
    ch.data.stats.falzKills = 1;
    ch.data.stats.bossKills = { dragon: 1, derolle: 1, warden: 1, falz: 1 };
    // Nightmare and Hell open too (every boss beaten on each).
    ch.data.stats.hardKills = { dragon: 1, derolle: 1, warden: 1, falz: 1 };
    ch.data.stats.hellKills = { dragon: 1, derolle: 1, warden: 1, falz: 1 };
    return ch;
  };
  window.goRoom = (id) => {
    const r = g.world.level.rooms.find((r) => r.def.id === id);
    g.player.pos.set((r.rect.minX + r.rect.maxX) / 2, 0, (r.rect.minZ + r.rect.maxZ) / 2);
    window.__h.run(0.1);
  };
  window.approach = () => {
    const ts = g.world.targets();
    // Mines: go for the control node first, as a player would.
    const node = ts.find((t) => t.arch?.ai === 'node');
    // The bot keeps the camera on window.botFocus when set (no Tab lock since 2026-10-16).
    window.botFocus = node ?? null;
    if (!ts.length) return;
    const p = g.player.pos;
    ts.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    const t = node ?? ts[0];
    const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
    if (d > 12) {
      p.x += ((t.pos.x - p.x) / d) * (d - 10);
      p.z += ((t.pos.z - p.z) / d) * (d - 10);
    }
  };
  // Ruins: Corruption would clamp the 1e6 sim HP down to max HP; count its stacks instead (window.corrupted).
  window.corrupted = 0;
  const simCorrupt = (n) => {
    const p = g.player;
    const b = p.corruption;
    p.corruption = Math.min(5, b + n);
    window.corrupted += p.corruption - b;
    return p.corruption - b;
  };
  window.simRooms = (ids) => {
    const out = [];
    g.player.corrupt = simCorrupt;
    for (const id of ids) {
      goRoom(id);
      g.player.hp = 1e6;
      let t = 0;
      const kills0 = g.char.data.stats.kills;
      const start = performance.now();
      for (let i = 0; i < 300 && (g.world.roomActive || i < 2); i++) {
        approach();
        // Spells first, bolts when out of TP (window.botSeq overrides, e.g. ['b', 'b', 'a']).
        t += window.__h.bot(1, { keepGoing: true, late: window.botLate ?? 0, seq: window.botSeq ?? ['a', 'a', 'a'] });
        if (performance.now() - start > 25000) break;
      }
      out.push(`${id} ${t.toFixed(0)}s dmg${Math.round(1e6 - g.player.hp)} k${g.char.data.stats.kills - kills0}${g.world.roomActive ? ' STUCK' : ''}`);
    }
    return out;
  };
  const c = g.combat;
  window.dmgBy = {};
  c._hp = c.hurtPlayer.bind(c);
  // Every argument passes through (the attacker and the failed-mechanic flag after the source name).
  c.hurtPlayer = (...args) => {
    dmgBy[args[4]] = (dmgBy[args[4]] || 0) + args[0];
    return c._hp(...args);
  };
  const tick = c.tickPlayerStatus.bind(c);
  c.tickPlayerStatus = (dt) => {
    const before = g.player.hp;
    tick(dt);
    const d = before - g.player.hp;
    if (d > 0) dmgBy.poison = (dmgBy.poison || 0) + d;
  };
  window.realRender = g.renderer.render.bind(g.renderer);
  window.noRender = () => (g.renderer.render = () => {});
  window.yesRender = () => (g.renderer.render = window.realRender);

  // Balance: fresh throwaway character, bot clears the rooms, sums fight time and damage taken. Rod and wand per band
  // (the classes went on 2026-10-21; the old h* / r* keys were the Hunter and Ranger).
  window.SETUPS = {
    rodF1: [3, 'rod_1', 'frame_1', 'barrier_1', 'forest1', ['r1', 'r2', 'r3', 'r5']],
    wandF1: [3, 'wand_1', 'frame_1', 'barrier_1', 'forest1', ['r1', 'r2', 'r3', 'r5']],
    rodF: [7, 'rod_2', 'frame_psy_2', 'barrier_psy_2', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7']],
    wandF: [7, 'wand_2', 'frame_psy_2', 'barrier_psy_2', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7']],
    rodC: [15, 'rod_3', 'frame_psy_3', 'barrier_psy_3', 'cave1', ['c1', 'c2', 'c3', 'c4', 'c5']],
    wandC: [15, 'wand_3', 'frame_psy_3', 'barrier_psy_3', 'cave1', ['c1', 'c2', 'c3', 'c4', 'c5']],
    // Mines (unlocked by De Rol Le): Lv 24 tier 5 for Mine 1, Lv 28 for Mine 2.
    rodM: [24, 'rod_5', 'frame_psy_5', 'barrier_psy_5', 'mine1', ['m1', 'm2', 'm3', 'm4', 'm5']],
    rodM2: [28, 'rod_5', 'frame_psy_5', 'barrier_psy_5', 'mine2', ['n1', 'n2', 'n3', 'n4', 'n5']],
    // Ruins (unlocked by the Warden): Lv 34 tier 6 for Ruin 1, Lv 38 tier 6-7 for Ruin 2.
    rodR: [34, 'rod_6', 'frame_psy_6', 'barrier_psy_6', 'ruin1', ['r1', 'r2', 'r3', 'r4', 'r5']],
    rodR2: [38, 'rod_6', 'frame_psy_7', 'barrier_psy_6', 'ruin2', ['s1', 's2', 's3', 's4', 's5']],
    // Nightmare (last arg true): Forest at Lv 44 with tier 7 (the Normal Ruins' gear).
    rodHF: [44, 'rod_7', 'frame_psy_7', 'barrier_psy_7', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7'], true],
    wandHF: [44, 'wand_7', 'frame_psy_7', 'barrier_psy_7', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7'], true],
    rodHC: [54, 'rod_8', 'frame_psy_8', 'barrier_psy_8', 'cave1', ['c1', 'c2', 'c3', 'c4', 'c5'], true],
    rodHM: [66, 'rod_9', 'frame_psy_9', 'barrier_psy_9', 'mine2', ['n1', 'n2', 'n3', 'n4', 'n5'], true],
    rodHR: [76, 'rod_10', 'frame_psy_10', 'barrier_psy_10', 'ruin2', ['s1', 's2', 's3', 's4', 's5'], true],
    // Hell (last arg 'hell'): each band entered with the gear of the band before (no Haste: shop-clean items).
    rodXF: [84, 'rod_11', 'frame_psy_11', 'barrier_psy_11', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7'], 'hell'],
    wandXF: [84, 'wand_11', 'frame_psy_11', 'barrier_psy_11', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7'], 'hell'],
    rodXC: [89, 'rod_12', 'frame_psy_12', 'barrier_psy_12', 'cave1', ['c1', 'c2', 'c3', 'c4', 'c5'], 'hell'],
    rodXM: [93, 'rod_13', 'frame_psy_13', 'barrier_psy_13', 'mine2', ['n1', 'n2', 'n3', 'n4', 'n5'], 'hell'],
    rodXR: [98, 'rod_14', 'frame_psy_14', 'barrier_psy_14', 'ruin2', ['s1', 's2', 's3', 's4', 's5'], 'hell'],
  };
  window.simRun = (lvl, w, f, b, area, rooms, hard = false, passives = []) => {
    // hard: true = Nightmare, 'hell' = Hell.
    g.startCharacter(-1, mkChar(lvl, w, f, b, passives), hard === 'hell' ? 'hell' : hard ? 'nightmare' : 'normal');
    window.__h.run(0.1);
    g.newExpedition(area === 'forest1' ? 'forest' : area.startsWith('mine') ? 'mines' : area.startsWith('ruin') ? 'ruins' : 'caves');
    g.enterArea(area, 'start');
    window.__h.run(0.5);
    noRender();
    window.corrupted = 0;
    let time = 0, dmg = 0, stuck = 0;
    for (const s of simRooms(rooms)) {
      const m = s.match(/ (\d+)s dmg(-?\d+)/);
      if (!m) throw new Error(s);
      time += +m[1];
      dmg += +m[2];
      if (s.includes('STUCK')) stuck++;
    }
    return { time, dmg, bars: dmg / g.player.trueMaxHp, stuck, corrupted: window.corrupted };
  };
  /** Average n runs of each setup key: { key: { time, dmg, bars, stuck } }. */
  window.batch = (keys, n) => {
    const out = {};
    for (const k of keys) {
      const sum = { time: 0, dmg: 0, bars: 0, stuck: 0, corrupted: 0 };
      for (let i = 0; i < n; i++) {
        const r = simRun(...SETUPS[k]);
        for (const f in sum) sum[f] += r[f];
      }
      out[k] = { time: Math.round(sum.time / n), dmg: Math.round(sum.dmg / n), bars: +(sum.bars / n).toFixed(2), stuck: sum.stuck, corrupted: +(sum.corrupted / n).toFixed(1) };
    }
    return out;
  };
})();
