// Dev playtest helpers for the browser pane (paste into javascript_tool after a reload).
// Not loaded by the game. Defines mkChar / goRoom / simRooms / dmgBy on window.
(async () => {
  const { Character, makeItem } = await import('/src/game/character.ts');
  const { xpToNext } = await import('/src/game/data/classes.ts');
  const g = window.__h.game;
  window.mkChar = (cls, lvl, weapon, frame, barrier) => {
    const ch = Character.create('Tester', cls);
    let xp = 0;
    for (let l = 1; l < lvl; l++) xp += xpToNext(l);
    ch.addXp(xp);
    for (const [slot, id] of [['weapon', weapon], ['frame', frame], ['barrier', barrier]]) {
      if (!id) continue;
      const it = makeItem(id);
      ch.data.inventory.push(it);
      ch.data.equipped[slot] = it.uid;
    }
    ch.data.stats.dragonKills = 1;
    ch.data.stats.deRolLeKills = 1;
    ch.data.stats.wardenKills = 1;
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
    if (node && g.lockTarget !== node) g.lockTarget = node;
    if (!ts.length || (g.lockTarget && g.lockTarget.alive && !node)) return;
    const p = g.player.pos;
    ts.sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    const t = node ?? ts[0];
    const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
    if (d > 12) {
      p.x += ((t.pos.x - p.x) / d) * (d - 10);
      p.z += ((t.pos.z - p.z) / d) * (d - 10);
    }
  };
  window.simRooms = (ids) => {
    const out = [];
    for (const id of ids) {
      goRoom(id);
      g.player.hp = 1e6;
      let t = 0;
      const kills0 = g.char.data.stats.kills;
      const start = performance.now();
      for (let i = 0; i < 300 && (g.world.roomActive || i < 2); i++) {
        approach();
        t += window.__h.bot(1, { keepGoing: true, late: window.botLate ?? 0 });
        if (performance.now() - start > 25000) break;
      }
      out.push(`${id} ${t.toFixed(0)}s dmg${Math.round(1e6 - g.player.hp)} k${g.char.data.stats.kills - kills0}${g.world.roomActive ? ' STUCK' : ''}`);
    }
    return out;
  };
  const c = g.combat;
  window.dmgBy = {};
  c._hp = c.hurtPlayer.bind(c);
  c.hurtPlayer = (dmg, fx, fz, kb, src) => {
    dmgBy[src] = (dmgBy[src] || 0) + dmg;
    return c._hp(dmg, fx, fz, kb, src);
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

  // Class balance: fresh throwaway character, bot clears the rooms, sums fight time and damage taken.
  window.SETUPS = {
    hF1: ['hunter', 3, 'saber_1', 'frame_1', 'barrier_1', 'forest1', ['r1', 'r2', 'r3', 'r5']],
    rF1: ['ranger', 3, 'handgun_1', 'frame_1', 'barrier_1', 'forest1', ['r1', 'r2', 'r3', 'r5']],
    hF: ['hunter', 7, 'saber_2', 'frame_guard_2', 'barrier_guard_2', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7']],
    rF: ['ranger', 7, 'handgun_2', 'frame_combat_2', 'barrier_combat_2', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7']],
    hC: ['hunter', 15, 'saber_3', 'frame_guard_3', 'barrier_guard_3', 'cave1', ['c1', 'c2', 'c3', 'c4', 'c5']],
    rC: ['ranger', 15, 'handgun_3', 'frame_combat_3', 'barrier_combat_3', 'cave1', ['c1', 'c2', 'c3', 'c4', 'c5']],
    // Mines (unlocked by De Rol Le): Lv 24 tier 5 for Mine 1, Lv 28 for Mine 2.
    hM: ['hunter', 24, 'saber_5', 'frame_guard_5', 'barrier_guard_5', 'mine1', ['m1', 'm2', 'm3', 'm4', 'm5']],
    rM: ['ranger', 24, 'handgun_5', 'frame_combat_5', 'barrier_combat_5', 'mine1', ['m1', 'm2', 'm3', 'm4', 'm5']],
    hM2: ['hunter', 28, 'saber_5', 'frame_guard_5', 'barrier_guard_5', 'mine2', ['n1', 'n2', 'n3', 'n4', 'n5']],
    rM2: ['ranger', 28, 'handgun_5', 'frame_combat_5', 'barrier_combat_5', 'mine2', ['n1', 'n2', 'n3', 'n4', 'n5']],
    // Hard (last arg true): Forest at Lv 37 with tier 6, the band the Normal Mines hand over to.
    hHF: ['hunter', 37, 'saber_6', 'frame_guard_6', 'barrier_guard_6', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7'], true],
    rHF: ['ranger', 37, 'handgun_6', 'frame_combat_6', 'barrier_combat_6', 'forest1', ['r1', 'r2', 'r3', 'r5', 'r6', 'r7'], true],
    hHC: ['hunter', 46, 'saber_7', 'frame_guard_7', 'barrier_guard_7', 'cave1', ['c1', 'c2', 'c3', 'c4', 'c5'], true],
    hHM: ['hunter', 56, 'saber_8', 'frame_guard_8', 'barrier_guard_8', 'mine2', ['n1', 'n2', 'n3', 'n4', 'n5'], true],
  };
  window.simClass = (cls, lvl, w, f, b, area, rooms, hard = false) => {
    g.startCharacter(-1, mkChar(cls, lvl, w, f, b));
    window.__h.run(0.1);
    g.newExpedition(area === 'forest1' ? 'forest' : area.startsWith('mine') ? 'mines' : 'caves', hard);
    g.enterArea(area, 'start');
    window.__h.run(0.5);
    noRender();
    let time = 0, dmg = 0, stuck = 0;
    for (const s of simRooms(rooms)) {
      const m = s.match(/ (\d+)s dmg(-?\d+)/);
      if (!m) throw new Error(s);
      time += +m[1];
      dmg += +m[2];
      if (s.includes('STUCK')) stuck++;
    }
    return { time, dmg, bars: dmg / g.player.maxHp, stuck };
  };
  /** Average n runs of each setup key: { key: { time, dmg, bars, stuck } }. */
  window.batch = (keys, n) => {
    const out = {};
    for (const k of keys) {
      const sum = { time: 0, dmg: 0, bars: 0, stuck: 0 };
      for (let i = 0; i < n; i++) {
        const r = simClass(...SETUPS[k]);
        for (const f in sum) sum[f] += r[f];
      }
      out[k] = { time: Math.round(sum.time / n), dmg: Math.round(sum.dmg / n), bars: +(sum.bars / n).toFixed(2), stuck: sum.stuck };
    }
    return out;
  };
})();
