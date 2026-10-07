import { engine, mix } from './engine';
import { trimGain } from './levels';
import { pickOf } from './picks';
import { SFX, type SfxDef, type SfxId } from './sfx';
import type { V } from './synth';

// Public audio API for the game: sfx('hit.normal', { x, z }) and music.play('forest').

export { music } from './music/sequencer';
export type { TrackId } from './music/tracks';
export type { SfxId } from './sfx';
export { mix };
export type { Space } from './engine';

export interface SfxOpts {
  /** World position (omit for UI / player-centred sounds). */
  x?: number;
  z?: number;
  vol?: number;
  /** Pitch multiplier. */
  pitch?: number;
  /** Recipe argument (breath length, enemy size...). */
  arg?: number;
  /** Force a variant (sound lab). */
  variant?: number;
}

/** Create the audio graph; it starts on the first user gesture. */
export function initAudio(): void {
  engine.init();
}

/** Dev: the last sounds played (for automated playtests). */
export const sfxLog: string[] = [];

const recent = new Map<string, number[]>();
const MAX_VOICES = 48;
let voices = 0;

export function sfx(id: SfxId, o: SfxOpts = {}): void {
  const ctx = engine.ctx;
  if (!ctx || ctx.state !== 'running') return;
  const def: SfxDef = SFX[id];
  const now = ctx.currentTime;

  // Distance and stereo position relative to the player / camera.
  let gain = o.vol ?? 1;
  let pan = 0;
  if (o.x !== undefined && o.z !== undefined) {
    const l = engine.listener;
    const dx = o.x - l.x;
    const dz = o.z - l.z;
    const d = Math.hypot(dx, dz);
    const ref = def.ref ?? 8;
    if (d > ref) gain *= Math.pow(ref / d, 1.3);
    if (gain < 0.02) return;
    if (d > 0.5) pan = Math.max(-1, Math.min(1, ((dx * l.rx + dz * l.rz) / d) * 0.75 * Math.min(1, d / 4)));
  }

  // Throttle: min gap and max overlap per sound, plus a global voice cap.
  const times = (recent.get(id) ?? []).filter((t) => t > now - (def.len ?? 3) * 0.5);
  if (times.length && now - times[times.length - 1] < (def.gap ?? 0.03)) return;
  if (times.length >= (def.max ?? 4) || voices >= MAX_VOICES) return;
  times.push(now);
  recent.set(id, times);

  let vi = o.variant ?? pickOf(id);
  if (!def.variants[vi]) vi = 0;
  const out = ctx.createGain();
  out.gain.value = gain * trimGain(id, vi);
  let tail: AudioNode = out;
  if (pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p);
    tail = p;
  }
  if (def.duck) {
    tail.connect(engine.jingleBus);
    engine.duck(def.duck);
  } else tail.connect(engine.sfxBus);
  // Recipes send to the reverb from inside the voice, so the send needs the same gain.
  const wet = ctx.createGain();
  wet.gain.value = out.gain.value * (def.duck ? mix.music * 0.3 : 1);
  wet.connect(def.duck ? engine.reverb : engine.sfxVerb);

  const jitter = def.jitter ?? 0.04;
  const v: V = { ctx, out, wet, t: now + 0.005, p: (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * jitter) };
  def.variants[vi].play(v, o.arg ?? def.x ?? 1);

  if (import.meta.env.DEV) {
    sfxLog.push(id);
    if (sfxLog.length > 300) sfxLog.shift();
  }
  voices++;
  setTimeout(() => {
    voices--;
    out.disconnect();
    wet.disconnect();
  }, ((def.len ?? 3) + 0.5) * 1000);
}

export function setListener(x: number, z: number, rightX: number, rightZ: number): void {
  engine.setListener(x, z, rightX, rightZ);
}

export const setSpace = (s: Parameters<typeof engine.setSpace>[0]) => engine.setSpace(s);
export const setMuffled = (on: boolean) => engine.setMuffled(on);
export const applyMix = () => engine.applyMix();
