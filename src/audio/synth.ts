// Tiny synthesis toolkit: every SFX recipe and music instrument is built from
// these few primitives (oscillator, FM pair, filtered noise, envelopes).

/** Where (and when) a sound plays. */
export interface V {
  ctx: BaseAudioContext;
  /** Dry destination. */
  out: AudioNode;
  /** Reverb send (null: dry only). */
  wet: AudioNode | null;
  /** Start time (context seconds). */
  t: number;
  /** Pitch multiplier applied to every frequency (random variation, heavy hits...). */
  p: number;
}

export interface Env {
  /** Attack seconds. */
  a?: number;
  /** Hold at peak. */
  h?: number;
  /** Decay: to silence (percussive) or to the sustain level (when `len` is set). */
  d: number;
  peak?: number;
  /** Sustained notes: sustain level (0..1 of peak), release and note length. */
  s?: number;
  r?: number;
  len?: number;
}

export interface FilterOpts {
  type: BiquadFilterType;
  f: number;
  /** Sweep target frequency (reached at `fT` seconds). */
  f1?: number;
  fT?: number;
  q?: number;
  gain?: number;
}

export interface OscOpts extends Env {
  type?: OscillatorType;
  f: number;
  /** Pitch sweep target and its time (default: over the whole decay). */
  f1?: number;
  fT?: number;
  fLin?: boolean;
  detune?: number;
  gain?: number;
  /** Reverb send amount. */
  wet?: number;
  filter?: FilterOpts;
  /** Start offset from v.t (seconds). */
  at?: number;
  /** Vibrato: rate Hz, depth cents, delay seconds. */
  vib?: [number, number, number?];
  pan?: number;
}

export interface FmOpts extends OscOpts {
  /** Modulator frequency = carrier * ratio. */
  ratio: number;
  /** Modulation index (in multiples of the modulator frequency). */
  index: number;
  /** Index at the end of `indexT` (brightness decay). */
  index1?: number;
  indexT?: number;
  modType?: OscillatorType;
}

export interface NoiseOpts extends Env {
  color?: 'white' | 'pink' | 'brown';
  gain?: number;
  wet?: number;
  filter?: FilterOpts;
  /** A second filter in series (e.g. band-limit a sweep). */
  filter2?: FilterOpts;
  at?: number;
  pan?: number;
}

const SILENT = 0.0001;

/** Apply an envelope to a gain param. Returns the time the sound is silent. */
export function envelope(g: AudioParam, t: number, e: Env): number {
  const peak = e.peak ?? 1;
  const a = Math.max(0.001, e.a ?? 0.002);
  const h = e.h ?? 0;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  if (e.len !== undefined) {
    const sus = Math.max(SILENT, (e.s ?? 0.7) * peak);
    const r = e.r ?? 0.1;
    g.setValueAtTime(peak, t + a + h);
    g.setTargetAtTime(sus, t + a + h, Math.max(0.005, e.d / 3));
    const off = t + Math.max(e.len, a + h + 0.01);
    g.setTargetAtTime(0, off, Math.max(0.005, r / 4));
    return off + r;
  }
  g.setValueAtTime(peak, t + a + h);
  g.exponentialRampToValueAtTime(SILENT * peak + 1e-7, t + a + h + Math.max(0.005, e.d));
  g.setValueAtTime(0, t + a + h + Math.max(0.005, e.d) + 0.001);
  return t + a + h + e.d;
}

function sweep(param: AudioParam, t: number, from: number, to: number | undefined, dur: number, lin = false): void {
  param.setValueAtTime(from, t);
  if (to === undefined || to === from) return;
  if (lin) param.linearRampToValueAtTime(to, t + dur);
  else param.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
}

export function makeFilter(v: V, t: number, o: FilterOpts, dur: number, scale = true): BiquadFilterNode {
  const f = v.ctx.createBiquadFilter();
  f.type = o.type;
  const k = scale ? v.p : 1;
  sweep(f.frequency, t, o.f * k, o.f1 !== undefined ? o.f1 * k : undefined, o.fT ?? dur);
  f.Q.value = o.q ?? (o.type === 'lowpass' || o.type === 'highpass' ? 0.7 : 1);
  if (o.gain !== undefined) f.gain.value = o.gain;
  return f;
}

/** Route `node` through gain (+ optional pan) into the voice, plus a reverb send. */
function finish(v: V, node: AudioNode, gain: AudioNode, wet: number | undefined, pan: number | undefined): void {
  node.connect(gain);
  let out: AudioNode = gain;
  if (pan) {
    const p = v.ctx.createStereoPanner();
    p.pan.value = pan;
    gain.connect(p);
    out = p;
  }
  out.connect(v.out);
  if (wet && v.wet) {
    const s = v.ctx.createGain();
    s.gain.value = wet;
    out.connect(s);
    s.connect(v.wet);
  }
}

function addVibrato(v: V, osc: OscillatorNode, t: number, end: number, vib: [number, number, number?]): void {
  const lfo = v.ctx.createOscillator();
  lfo.frequency.value = vib[0];
  const depth = v.ctx.createGain();
  const delay = vib[2] ?? 0;
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(0, t + delay);
  depth.gain.linearRampToValueAtTime(vib[1], t + delay + 0.25);
  lfo.connect(depth);
  depth.connect(osc.detune);
  lfo.start(t);
  lfo.stop(end + 0.05);
}

/** One oscillator with pitch sweep, envelope and optional filter. Returns its end time. */
export function tone(v: V, o: OscOpts): number {
  const t = v.t + (o.at ?? 0);
  const osc = v.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  const dur = (o.a ?? 0.002) + (o.h ?? 0) + o.d + (o.len ?? 0);
  sweep(osc.frequency, t, o.f * v.p, o.f1 !== undefined ? o.f1 * v.p : undefined, o.fT ?? dur, o.fLin);
  if (o.detune) osc.detune.value = o.detune;
  const g = v.ctx.createGain();
  const end = envelope(g.gain, t, { ...o, peak: (o.peak ?? 1) * (o.gain ?? 0.3) });
  if (o.vib) addVibrato(v, osc, t, end, o.vib);
  let node: AudioNode = osc;
  if (o.filter) {
    const f = makeFilter(v, t, o.filter, end - t);
    osc.connect(f);
    node = f;
  }
  finish(v, node, g, o.wet, o.pan);
  osc.start(t);
  osc.stop(end + 0.05);
  return end;
}

/** Two-operator FM: bells, electric piano, metallic hits, growls. */
export function fm(v: V, o: FmOpts): number {
  const t = v.t + (o.at ?? 0);
  const ctx = v.ctx;
  const car = ctx.createOscillator();
  car.type = o.type ?? 'sine';
  const mod = ctx.createOscillator();
  mod.type = o.modType ?? 'sine';
  const dur = (o.a ?? 0.002) + (o.h ?? 0) + o.d + (o.len ?? 0);
  const f0 = o.f * v.p;
  const f1 = o.f1 !== undefined ? o.f1 * v.p : undefined;
  sweep(car.frequency, t, f0, f1, o.fT ?? dur, o.fLin);
  sweep(mod.frequency, t, f0 * o.ratio, f1 !== undefined ? f1 * o.ratio : undefined, o.fT ?? dur, o.fLin);
  const mg = ctx.createGain();
  const i0 = o.index * f0 * o.ratio;
  mg.gain.setValueAtTime(i0, t);
  if (o.index1 !== undefined) mg.gain.exponentialRampToValueAtTime(Math.max(0.01, o.index1 * f0 * o.ratio), t + (o.indexT ?? dur));
  mod.connect(mg);
  mg.connect(car.frequency);
  if (o.detune) car.detune.value = o.detune;
  const g = ctx.createGain();
  const end = envelope(g.gain, t, { ...o, peak: (o.peak ?? 1) * (o.gain ?? 0.3) });
  if (o.vib) addVibrato(v, car, t, end, o.vib);
  let node: AudioNode = car;
  if (o.filter) {
    const f = makeFilter(v, t, o.filter, end - t);
    car.connect(f);
    node = f;
  }
  finish(v, node, g, o.wet, o.pan);
  car.start(t);
  mod.start(t);
  car.stop(end + 0.05);
  mod.stop(end + 0.05);
  return end;
}

const noiseCache = new WeakMap<BaseAudioContext, Record<string, AudioBuffer>>();

export function noiseBuffer(ctx: BaseAudioContext, color: 'white' | 'pink' | 'brown'): AudioBuffer {
  let c = noiseCache.get(ctx);
  if (!c) noiseCache.set(ctx, (c = {}));
  if (c[color]) return c[color];
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'white') d[i] = w * 0.5;
    else if (color === 'pink') {
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.9;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
  }
  return (c[color] = buf);
}

/** Filtered noise burst (hits, whooshes, fire, water, footsteps). */
export function noise(v: V, o: NoiseOpts): number {
  const t = v.t + (o.at ?? 0);
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx, o.color ?? 'white');
  src.loop = true;
  const g = v.ctx.createGain();
  const end = envelope(g.gain, t, { ...o, peak: (o.peak ?? 1) * (o.gain ?? 0.3) });
  let node: AudioNode = src;
  for (const fo of [o.filter, o.filter2]) {
    if (!fo) continue;
    const f = makeFilter(v, t, fo, end - t);
    node.connect(f);
    node = f;
  }
  finish(v, node, g, o.wet, o.pan);
  src.start(t, Math.random() * 1.5);
  src.stop(end + 0.05);
  return end;
}

/** A sub-voice whose output runs through its own gain / filter / distortion into `v`. */
export function group(
  v: V,
  o: { gain?: number; filter?: FilterOpts; drive?: number; at?: number; dur?: number; wet?: number } = {},
): V {
  const ctx = v.ctx;
  const t = v.t + (o.at ?? 0);
  const g = ctx.createGain();
  g.gain.value = o.gain ?? 1;
  let head: AudioNode = g;
  let tail: AudioNode = g;
  if (o.drive) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(o.drive);
    ws.oversample = '2x';
    tail.connect(ws);
    tail = ws;
  }
  if (o.filter) {
    const f = makeFilter(v, t, o.filter, o.dur ?? 1);
    tail.connect(f);
    tail = f;
  }
  tail.connect(v.out);
  let wet = v.wet;
  if (o.wet !== undefined && v.wet) {
    const s = ctx.createGain();
    s.gain.value = o.wet;
    s.connect(v.wet);
    wet = s;
  }
  return { ctx, out: head, wet, t, p: v.p };
}

const curves = new Map<number, Float32Array<ArrayBuffer>>();

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(amount * 10);
  const hit = curves.get(key);
  if (hit) return hit;
  const n = 1024;
  const c = new Float32Array(n);
  const k = amount * 8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  curves.set(key, c);
  return c;
}

/** Same voice, shifted later in time. */
export const later = (v: V, sec: number): V => ({ ...v, t: v.t + sec });
/** Same voice, transposed. */
export const pitched = (v: V, mult: number): V => ({ ...v, p: v.p * mult });

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
