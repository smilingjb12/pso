import { Game } from './game/Game';

const game = new Game(document.getElementById('app')!);
game.start();

// Dev-only: expose the game and a test harness for console / automated playtesting.
if (import.meta.env.DEV) {
  (window as unknown as { game: Game }).game = game;
  import('./devHarness').then((m) => m.installHarness(game));
  Promise.all([import('./audio'), import('./audio/engine')]).then(([audio, { engine }]) => {
    (window as unknown as { audio: unknown }).audio = { ...audio, engine };
  });
}
