// Dev-only helpers for driving the game from the console or automated tests
// without pointer lock or requestAnimationFrame (e.g. in a hidden tab).
//   __h.start(slot, kit?, difficulty?)  load or create a character (kit: vanguard / ranger / mystic) and enter the city ('nightmare' if open)
//   __h.run(sec)     step the simulation with fixed 60 Hz frames
//   __h.bot(sec)     fight nearby enemies with a naive combo bot (opts.late: chain this many s into the window)

/* eslint-disable @typescript-eslint/no-explicit-any */
import { mix } from './audio';
import { engine } from './audio/engine';

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

  const bot = (sec: number, opts: { keepGoing?: boolean; seq?: (number | 'E')[]; late?: number } = {}) => {
    const p = game.player;
    const c = p.combo;
    // Mouse buttons per combo hit: 2 = RMB (light, area), 0 = LMB (heavy, single target).
    const seq = opts.seq ?? [2, 2, 0];
    let walking = false;
    let t = 0;
    for (; t < sec * 60; t++) {
      if (!p.alive) break;
      const targets = game.world.targets();
      if (!targets.length && !opts.keepGoing) break;
      if ((!game.lockTarget || !game.lockTarget.alive) && targets.length) {
        key('KeyF');
        run(1 / 60);
        if (!game.lockTarget) key('KeyF');
      }
      const tg = game.lockTarget;
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
        const reach = game.char.weaponKind().ranged ? 10 : 1.6;
        if (d > reach && c.phase !== 'swing') {
          game.rig.yaw = yawTo(p.pos.x, p.pos.z, tg.pos.x, tg.pos.z);
          if (!walking) key('KeyW');
          walking = true;
        } else {
          if (walking) key('KeyW', 'keyup');
          walking = false;
          if (c.phase === 'idle' && p.canAct) click(seq[0] === 2 ? 2 : 0);
          else if (c.inWindow && c.t >= c.times.windowOpenAt + (opts.late ?? 0)) {
            const n = seq[c.hitIndex + 1];
            if (n === 'E') key('KeyE');
            else click(n === 2 ? 2 : 0);
          }
        }
      }
      run(1 / 60);
    }
    if (walking) key('KeyW', 'keyup');
    return t / 60;
  };

  const start = (slot = 0, kit = 'vanguard', difficulty = 'normal') => {
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
      title.onAction('goStep', '0');
      title.onAction('kit', kit);
      title.onAction('finish', '');
    }
    run(0.2);
  };

  (window as any).__h = { key, click, run, bot, start, yawTo, game };
}
