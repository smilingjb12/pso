// Web Audio plumbing shared by sound effects and music. Sound effects are all
// synthesized; music is synthesized too, except tracks with recorded loops
// (public/music, see tracks.ts).
//
//   sfx voices ─► panner ─► sfxBus ──────────────┐
//            └──► reverb send ─► reverb ─────────┤
//   music parts ─► layer gains ─► musicBus ─► muffle ─► master ─► compressor ─► trim ─► out
//
// The context can only start after a user gesture, so it is created lazily and
// resumed on the first click / key press. Until then (and in tests, where there
// is no AudioContext) every call is a cheap no-op.

export interface AudioMix {
  master: number;
  music: number;
  sfx: number;
}

/** Live mix levels (the tuning panel edits these). */
export const mix: AudioMix = { master: 0.8, music: 0.55, sfx: 0.9 };

/** Final output level, after the compressor: 0.8 = the whole game 20% quieter (2026-10-07). */
const OUTPUT_TRIM = 0.8;

export type Space = 'open' | 'room' | 'cave';

const SPACE_WET: Record<Space, number> = { open: 0.12, room: 0.2, cave: 0.42 };

class Engine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  /** Jingles: music level, but not ducked (they are what ducks the music). */
  jingleBus!: GainNode;
  /** Music goes through this low-pass so a pause can muffle it. */
  muffle!: BiquadFilterNode;
  reverb!: ConvolverNode;
  /** SFX reverb send level (by area). */
  sfxVerb!: GainNode;
  /** Music always gets a little hall. */
  musicVerb!: GainNode;
  private ducker!: GainNode;
  private unlockWaiters: (() => void)[] = [];
  private hiddenSuspend = false;

  /** Listener: the player position plus the camera's right vector (for panning). */
  readonly listener = { x: 0, z: 0, rx: 1, rz: 0 };

  get available(): boolean {
    return typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Create the graph (once) and hook the first user gesture to start it. */
  init(): void {
    if (this.ctx || !this.available) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    // Flat trim after the compressor, so it lowers everything evenly (a cut before it would be
    // partly undone on loud moments).
    const out = ctx.createGain();
    out.gain.value = OUTPUT_TRIM;
    out.connect(ctx.destination);
    comp.connect(out);

    this.master = ctx.createGain();
    this.master.connect(comp);

    this.ducker = ctx.createGain();
    this.ducker.connect(this.master);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.muffle.connect(this.ducker);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.muffle);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.jingleBus = ctx.createGain();
    this.jingleBus.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 2.6, 2.4);
    this.reverb.connect(this.master);
    this.sfxVerb = ctx.createGain();
    this.sfxVerb.gain.value = SPACE_WET.open;
    this.sfxVerb.connect(this.reverb);
    // Music has its own hall, inside the music bus so volume, muffle and ducking apply to it.
    const hall = ctx.createConvolver();
    hall.buffer = impulse(ctx, 3, 2.2);
    hall.connect(this.musicBus);
    this.musicVerb = ctx.createGain();
    this.musicVerb.gain.value = 0.22;
    this.musicVerb.connect(hall);

    this.applyMix();

    const unlock = () => {
      if (ctx.state !== 'running' && !this.hiddenSuspend) void ctx.resume();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) window.addEventListener(ev, unlock, { capture: true });
    ctx.addEventListener('statechange', () => {
      if (ctx.state !== 'running') return;
      const w = this.unlockWaiters;
      this.unlockWaiters = [];
      w.forEach((f) => f());
    });
    // Background tabs throttle timers, which would garble the music scheduler.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.hiddenSuspend = true;
        void ctx.suspend();
      } else {
        this.hiddenSuspend = false;
        void ctx.resume();
      }
    });
  }

  /** Run `f` as soon as the context is running (now, if it already is). */
  whenRunning(f: () => void): void {
    if (!this.ctx) return;
    if (this.running) f();
    else this.unlockWaiters.push(f);
  }

  applyMix(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(mix.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(mix.music, t, 0.05);
    this.jingleBus.gain.setTargetAtTime(mix.music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(mix.sfx, t, 0.05);
  }

  setSpace(space: Space): void {
    if (!this.ctx) return;
    this.sfxVerb.gain.setTargetAtTime(SPACE_WET[space], this.ctx.currentTime, 0.3);
  }

  /** Muffle the music (pause screen). */
  setMuffled(on: boolean): void {
    if (!this.ctx) return;
    this.muffle.frequency.setTargetAtTime(on ? 700 : 20000, this.ctx.currentTime, on ? 0.15 : 0.3);
  }

  /** Dip the music for a jingle. */
  duck(seconds: number, depth = 0.25): void {
    if (!this.ctx) return;
    const g = this.ducker.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.12);
    g.setValueAtTime(depth, t + seconds);
    g.linearRampToValueAtTime(1, t + seconds + 1.2);
  }

  setListener(x: number, z: number, rightX: number, rightZ: number): void {
    const l = this.listener;
    l.x = x;
    l.z = z;
    const len = Math.hypot(rightX, rightZ) || 1;
    l.rx = rightX / len;
    l.rz = rightZ / len;
  }
}

export const engine = new Engine();

/** Stereo impulse response: decaying noise with a darker tail. */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // One-pole low-pass that closes over time: early reflections bright, tail dark.
      const a = 0.15 + 0.8 * k;
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * Math.pow(1 - k, decay) * (i < rate * 0.008 ? 0 : 1) * 2.2;
    }
  }
  return buf;
}
