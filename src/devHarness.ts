// Dev-only helpers for driving the game from the console or automated tests
// without pointer lock or requestAnimationFrame (e.g. in a hidden tab).
//   __h.start(slot, difficulty?)  load or create a character and enter the city ('nightmare' if open)
//   __h.run(sec)     step the simulation with fixed 60 Hz frames
//   __h.bot(sec)     fight nearby enemies with a naive chain bot: basic, basic, the first ready damaging Art
//                    (opts.seq: per step 'b' basic, 'a' that Art, 0-3 a bar slot; opts.late: chain this many s into the window)

/* eslint-disable @typescript-eslint/no-explicit-any */
import { mix } from './audio';
import { engine } from './audio/engine';
import { ARTS } from './game/data/arts';
import { fightLog } from './game/fightLog';

export function installHarness(game: any): void {
  // Pointer lock can't be granted to scripted input; failed requests would re-show the pause overlay.
  // Only stub it once a script starts driving the game, so normal play keeps working.
  let scripted = false;
  const takeOver = () => {
    if (scripted) return;
    scripted = true;
    game.input.requestLock = () => {};
    // Scripted sessions run in tool browsers: keep them silent (real play never calls the harness).
    mix.master = 0;
    engine.applyMix();
  };
  const canvas = () => document.querySelector('canvas') as HTMLCanvasElement;
  const key = (code: string, type: 'keydown' | 'keyup' = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code }));
  const click = (b: number) => {
    canvas().dispatchEvent(new MouseEvent('mousedown', { button: b }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: b }));
  };
  let now = performance.now();
  const run = (sec: number) => {
    takeOver();
    const n = Math.max(1, Math.round(sec * 60));
    for (let i = 0; i < n; i++) {
      game.input.locked = true;
      now += 1000 / 60;
      game.frame(now);
    }
    game.hud.showOverlay(null);
  };
  const yawTo = (x1: number, z1: number, x2: number, z2: number) => Math.atan2(x2 - x1, z2 - z1);

  /** The Art bar's keys (RMB, Q, E, R), pressed like a player would. */
  const pressSlot = (slot: number) => (slot === 0 ? click(2) : key(['', 'KeyQ', 'KeyE', 'KeyR'][slot]));
  /**
   * One chain step: 'b' the basic attack (LMB), a number an Art bar slot (0-3 = RMB, Q, E, R), 'a' the first Art on
   * the bar that deals damage and is ready (else the basic attack).
   */
  const pressStep = (step: 'b' | 'a' | number) => {
    if (step === 'b') return click(0);
    if (typeof step === 'number') return pressSlot(step);
    const ch = game.char;
    const next = game.player.combo.phase === 'idle' ? 0 : game.player.combo.hitIndex + 1;
    for (let s = 0; s < 4; s++) {
      const id = ch.artInSlot(s);
      if (!id || !['area', 'single'].includes(ARTS[id as keyof typeof ARTS].role)) continue;
      if (game.combat.artBlocked(id, next) === null) return pressSlot(s);
    }
    click(0);
  };

  const bot = (sec: number, opts: { keepGoing?: boolean; seq?: ('b' | 'a' | number)[]; late?: number } = {}) => {
    const p = game.player;
    const c = p.combo;
    // Per chain step: basic, basic, then the first ready damaging Art (or a third basic step).
    const seq = opts.seq ?? ['b', 'b', 'a'];
    let walking = false;
    // The camera picks the target (no Tab lock since 2026-10-16): the bot keeps the camera on the nearest enemy
    // (window.botFocus overrides it, e.g. a Mines control node).
    let tg: any = null;
    let t = 0;
    for (; t < sec * 60; t++) {
      if (!p.alive) break;
      const targets = game.world.targets();
      if (!targets.length && !opts.keepGoing) break;
      const focus = (window as any).botFocus;
      if (focus?.alive) tg = focus;
      else if (!tg || !tg.alive || tg.invulnerable) {
        tg = null;
        let best = Infinity;
        for (const e of targets) {
          const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
          if (d < best) [best, tg] = [d, e];
        }
      }
      if (tg) game.rig.yaw = yawTo(p.pos.x, p.pos.z, tg.pos.x, tg.pos.z);
      // Low HP: take a dose from a Mate injector that has one.
      if (p.hp < p.maxHp * 0.35 && p.canMove) {
        const inj = game.char.injector();
        if (inj && inj.id.startsWith('mate') && (inj.charge ?? 99) >= 1) {
          key('Digit1');
          run(1 / 60);
          key('Digit1', 'keyup');
        }
      }
      if (tg) {
        const d = Math.hypot(tg.pos.x - p.pos.x, tg.pos.z - p.pos.z) - tg.radius;
        // Photon bolts reach 13 m: close to 10.
        if (d > 10 && c.phase !== 'swing') {
          game.rig.yaw = yawTo(p.pos.x, p.pos.z, tg.pos.x, tg.pos.z);
          if (!walking) key('KeyW');
          walking = true;
        } else {
          if (walking) key('KeyW', 'keyup');
          walking = false;
          if (c.phase === 'idle' && p.canAct) pressStep(seq[0]);
          else if (c.inWindow && c.t >= c.times.windowOpenAt + (opts.late ?? 0)) pressStep(seq[c.hitIndex + 1]);
        }
      }
      run(1 / 60);
    }
    if (walking) key('KeyW', 'keyup');
    return t / 60;
  };

  const start = (slot = 0, difficulty = 'normal') => {
    takeOver();
    const title = game.menus.menu;
    title.onAction('sel', String(slot));
    if (title.api.slots()[slot]) {
      title.onAction('load', '');
      title.onAction('diff', difficulty);
      title.onAction('enter', '');
    } else {
      title.onAction('new', '');
      title.editor.name = 'Bot';
      title.onAction('finish', '');
    }
    run(0.2);
  };

  (window as any).__h = { key, click, run, bot, start, yawTo, game, fightLog };
}
