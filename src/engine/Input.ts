// Keyboard + mouse input with pointer lock. Edge-triggered presses are
// collected per frame and cleared by endFrame().

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** Called when the lock is actually gained or lost (not on a browser's repeat event that changes nothing). */
  onLockChange: (locked: boolean) => void = () => {};
  /** When the last lock request went out, still unanswered (-Infinity: none). */
  private requestedAt = -Infinity;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressed.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      this.requestedAt = -Infinity;
      if (!this.locked) this.down.clear();
      // Only a real change: a repeat event (or one for a request that came to nothing) must not read as Esc.
      if (this.locked !== was) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.requestedAt = -Infinity;
    });
  }

  /**
   * Ask for the mouse, once: not while it is held, nor while a request is still out (a second request on top of the
   * first made the browser drop and retake it, reading as an Esc that reopened the inventory, 2026-10-22). Can be
   * refused (e.g. Chrome's cooldown right after Esc): the game goes on and the next click takes the mouse back.
   */
  requestLock(): void {
    if (this.locked || performance.now() - this.requestedAt < 1000) return;
    this.requestedAt = performance.now();
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {
      this.requestedAt = -Infinity;
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
