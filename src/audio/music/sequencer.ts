import { engine } from '../engine';
import type { V } from '../synth';
import { INSTRUMENTS } from './instruments';
import type { Layer, NoteEv, Part } from './theory';
import { TRACKS, type Track, type TrackId } from './tracks';

// Look-ahead step sequencer. A timer wakes every 25 ms and schedules every
// note that starts in the next ~150 ms on the audio clock, so timing stays
// sample-accurate even when frames hitch. Layers ('calm' / 'battle') have
// their own gain and crossfade on the beat.

const LOOKAHEAD = 0.15;
const TICK_MS = 25;

class TrackPlayer {
  readonly out: GainNode;
  /** Reverb send, faded together with `out`. */
  private wetOut: GainNode;
  private layerGain: Record<Layer, GainNode>;
  private layerWet: Record<Layer, GainNode>;
  /** Layer is audible or fading (worth scheduling). */
  private layerLive: Record<Layer, number> = { base: Infinity, calm: Infinity, battle: 0 };
  private byStep: { part: Part; ev: NoteEv; pan: StereoPannerNode | null }[][];
  private step = 0;
  private nextT: number;
  private readonly stepDur: number;
  private readonly loopSteps: number;
  battle = false;
  stopped = false;

  constructor(readonly track: Track, private ctx: AudioContext, dest: AudioNode, startAt: number, battle: boolean) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.wetOut = ctx.createGain();
    this.wetOut.connect(engine.musicVerb);
    const layers = () => ({ base: ctx.createGain(), calm: ctx.createGain(), battle: ctx.createGain() });
    this.layerGain = layers();
    this.layerWet = layers();
    for (const l of ['base', 'calm', 'battle'] as const) {
      this.layerGain[l].connect(this.out);
      this.layerWet[l].connect(this.wetOut);
      const on = l === 'base' || (l === 'battle') === battle ? 1 : 0;
      this.layerGain[l].gain.value = on;
      this.layerWet[l].gain.value = on;
    }
    this.battle = battle;
    this.layerLive = { base: Infinity, calm: battle ? 0 : Infinity, battle: battle ? Infinity : 0 };

    this.stepDur = 60 / track.bpm / 4;
    this.loopSteps = track.bars * 16;
    this.byStep = Array.from({ length: this.loopSteps }, () => []);
    for (const part of track.parts) {
      let pan: StereoPannerNode | null = null;
      if (part.pan) {
        pan = ctx.createStereoPanner();
        pan.pan.value = part.pan;
        pan.connect(this.layerGain[part.layer]);
      }
      for (const ev of part.notes) this.byStep[((ev.s % this.loopSteps) + this.loopSteps) % this.loopSteps].push({ part, ev, pan });
    }
    this.nextT = startAt;
  }

  setBattle(on: boolean): void {
    if (on === this.battle) return;
    this.battle = on;
    const now = this.ctx.currentTime;
    // Start the crossfade on the next beat; going into battle is quicker than coming out.
    const beat = this.stepDur * 4;
    const stepsToBeat = (4 - (this.step % 4)) % 4;
    const at = Math.max(now, this.nextT + stepsToBeat * this.stepDur - this.stepDur * 0.5);
    const fadeIn = on ? beat * 1.5 : beat * 6;
    const fadeOut = on ? beat * 2 : beat * 4;
    const ramp = (l: Layer, to: number, dur: number) => {
      for (const g of [this.layerGain[l], this.layerWet[l]]) {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.setValueAtTime(g.gain.value, at);
        g.gain.linearRampToValueAtTime(to, at + dur);
      }
    };
    ramp('battle', on ? 1 : 0, on ? fadeIn : fadeOut);
    ramp('calm', on ? 0 : 1, on ? fadeOut : fadeIn);
    this.layerLive.battle = on ? Infinity : at + fadeOut + 0.5;
    this.layerLive.calm = on ? at + fadeOut + 0.5 : Infinity;
  }

  fadeOut(sec: number): void {
    const now = this.ctx.currentTime;
    for (const g of [this.out.gain, this.wetOut.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + sec);
    }
    setTimeout(() => {
      this.stopped = true;
      this.out.disconnect();
      this.wetOut.disconnect();
    }, sec * 1000 + 200);
  }

  fadeIn(sec: number, at: number): void {
    for (const g of [this.out.gain, this.wetOut.gain]) {
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(this.track.gain ?? 1, at + sec);
    }
  }

  schedule(until: number): void {
    const swing = this.track.swing ?? 0;
    // After a stall (suspended context) skip ahead instead of firing a burst of late notes.
    const late = this.ctx.currentTime - this.nextT;
    if (late > 0.1) {
      const skip = Math.ceil(late / this.stepDur);
      this.step = (this.step + skip) % this.loopSteps;
      this.nextT += skip * this.stepDur;
    }
    while (this.nextT < until && !this.stopped) {
      const t = this.nextT + (swing && this.step % 4 === 2 ? swing * this.stepDur * 2 : 0);
      for (const { part, ev, pan } of this.byStep[this.step]) {
        if (this.layerLive[part.layer] < t) continue;
        const v: V = { ctx: this.ctx, out: pan ?? this.layerGain[part.layer], wet: this.layerWet[part.layer], t, p: 1 };
        const len = ev.l * this.stepDur * 0.92;
        const vel = ev.v * (part.gain ?? 1);
        INSTRUMENTS[part.inst](v, ev.n, len, vel);
      }
      this.nextT += this.stepDur;
      this.step = (this.step + 1) % this.loopSteps;
    }
  }
}

// ------------------------------------------------------------ recorded loops

/**
 * Loudness the recorded loops are normalised to (RMS dBFS, before the music
 * bus). Battle sits where the synth tracks do (Forest renders at about -15.4);
 * calm is ambient and kept further back.
 */
export const FILE_RMS_DB = { calm: -20, battle: -15.5 };
/** Loop seam crossfade, seconds. */
const SEAM = 3;

interface Loop {
  buffer: AudioBuffer;
  gain: number;
}

const loops = new Map<string, Promise<Loop>>();

function loadLoop(ctx: AudioContext, path: string, rmsDb: number): Promise<Loop> {
  let p = loops.get(path);
  if (!p) {
    p = fetch(import.meta.env.BASE_URL + path)
      .then((r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buf) => makeLoop(ctx, buf, rmsDb));
    p.catch(() => loops.delete(path));
    loops.set(path, p);
  }
  return p;
}

/**
 * Trim the silence around a recording and fold its last SEAM seconds into the
 * start (equal-power crossfade), so looping the result has no seam. Also works
 * out the gain that brings it to `rmsDb`.
 */
export function makeLoop(ctx: BaseAudioContext, src: AudioBuffer, rmsDb: number): Loop {
  const chans = Array.from({ length: src.numberOfChannels }, (_, c) => src.getChannelData(c));
  const loud = (i: number) => chans.some((d) => Math.abs(d[i]) > 0.003);
  let s0 = 0;
  while (s0 < src.length - 1 && !loud(s0)) s0++;
  let e = src.length;
  while (e > s0 + 1 && !loud(e - 1)) e--;
  const n = Math.min(Math.floor(SEAM * src.sampleRate), Math.floor((e - s0) / 4));
  const len = e - s0 - n;
  const out = ctx.createBuffer(chans.length, len, src.sampleRate);
  let sum = 0;
  chans.forEach((d, c) => {
    const o = out.getChannelData(c);
    o.set(d.subarray(s0, s0 + len));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      o[i] = d[s0 + i] * Math.sqrt(t) + d[s0 + len + i] * Math.sqrt(1 - t);
    }
    for (let i = 0; i < len; i++) sum += o[i] * o[i];
  });
  const rms = Math.sqrt(sum / (len * chans.length)) || 1;
  return { buffer: out, gain: Math.pow(10, rmsDb / 20) / rms };
}

/** Plays a track's recorded calm / battle loops side by side and crossfades between them. */
class FilePlayer {
  readonly out: GainNode;
  private layer: { calm: GainNode; battle: GainNode };
  private sources: AudioBufferSourceNode[] = [];
  private pendingFade: number | null = null;
  battle: boolean;
  stopped = false;
  /** Loading failed: the Music class falls back to the synthesized parts. */
  failed = false;
  private readonly single: boolean;

  constructor(readonly track: Track, private ctx: AudioContext, dest: AudioNode, startAt: number, battle: boolean) {
    this.battle = battle;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    const files = track.files!;
    // No battle file (the hub): the calm loop plays whatever the battle state.
    this.single = !files.battle;
    const fight = battle && !this.single;
    this.layer = { calm: ctx.createGain(), battle: ctx.createGain() };
    this.layer.calm.gain.value = fight ? 0 : 1;
    this.layer.battle.gain.value = fight ? 1 : 0;
    this.layer.calm.connect(this.out);
    this.layer.battle.connect(this.out);

    const layers = this.single ? (['calm'] as const) : (['calm', 'battle'] as const);
    Promise.all(layers.map((l) => loadLoop(ctx, files[l]!, FILE_RMS_DB[files.boss ? 'battle' : l]))).then(
      (got) => {
        if (this.stopped) return;
        const at = Math.max(startAt, ctx.currentTime + 0.05);
        layers.forEach((l, i) => {
          const norm = ctx.createGain();
          norm.gain.value = got[i].gain;
          norm.connect(this.layer[l]);
          const s = ctx.createBufferSource();
          s.buffer = got[i].buffer;
          s.loop = true;
          s.connect(norm);
          s.start(at);
          this.sources.push(s);
        });
        if (this.pendingFade !== null) this.rampOut(1, at, this.pendingFade);
      },
      (err) => {
        console.warn('music: recorded loop failed, using the synth version', err);
        this.failed = true;
      },
    );
  }

  private rampOut(to: number, at: number, sec: number): void {
    const g = this.out.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(to, at + sec);
  }

  setBattle(on: boolean): void {
    if (on === this.battle) return;
    this.battle = on;
    if (this.single) return;
    const now = this.ctx.currentTime;
    // Into battle quickly, back to calm slowly (as the synth tracks do).
    const ramp = (g: GainNode, to: number, dur: number) => {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(to, now + dur);
    };
    ramp(this.layer.battle, on ? 1 : 0, on ? 1.2 : 3);
    ramp(this.layer.calm, on ? 0 : 1, on ? 1.8 : 4.5);
  }

  fadeIn(sec: number, _at: number): void {
    // The real start time is only known once the files have loaded.
    if (this.sources.length) this.rampOut(1, this.ctx.currentTime, sec);
    else this.pendingFade = sec;
  }

  fadeOut(sec: number): void {
    this.pendingFade = null;
    this.rampOut(0, this.ctx.currentTime, sec);
    setTimeout(() => {
      this.stopped = true;
      for (const s of this.sources) s.stop();
      this.out.disconnect();
    }, sec * 1000 + 200);
  }

  schedule(_until: number): void {}
}

type Player = TrackPlayer | FilePlayer;

class Music {
  private player: Player | null = null;
  private fading: Player[] = [];
  private wantId: TrackId | null = null;
  private wantBattle = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  get current(): TrackId | null {
    return this.wantId;
  }

  get battle(): boolean {
    return this.wantBattle;
  }

  /** Switch tracks (crossfading). null fades the music out. */
  play(id: TrackId | null, opts: { battle?: boolean; fade?: number } = {}): void {
    if (opts.battle !== undefined) this.wantBattle = opts.battle;
    if (id === this.wantId && this.player && !this.player.stopped) {
      this.player.setBattle(this.wantBattle);
      return;
    }
    this.wantId = id;
    engine.whenRunning(() => this.apply(opts.fade ?? 1.2));
  }

  setBattle(on: boolean): void {
    this.wantBattle = on;
    this.player?.setBattle(on);
  }

  stop(fade = 1.5): void {
    this.play(null, { fade });
  }

  private apply(fade: number): void {
    const ctx = engine.ctx;
    if (!ctx) return;
    if (this.player && this.player.track.id === this.wantId && !this.player.stopped) return;
    if (this.player) {
      this.player.fadeOut(fade);
      this.fading.push(this.player);
      this.player = null;
    }
    if (this.wantId) {
      const start = ctx.currentTime + 0.1 + (this.fading.length ? fade * 0.4 : 0);
      const track = TRACKS[this.wantId];
      this.player = track.files
        ? new FilePlayer(track, ctx, engine.musicBus, start, this.wantBattle)
        : new TrackPlayer(track, ctx, engine.musicBus, start, this.wantBattle);
      this.player.fadeIn(track.files ? 1.5 : 0.6, start);
    }
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const ctx = engine.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const until = ctx.currentTime + LOOKAHEAD;
    if (this.player instanceof FilePlayer && this.player.failed) {
      const start = ctx.currentTime + 0.05;
      this.player = new TrackPlayer(this.player.track, ctx, engine.musicBus, start, this.wantBattle);
      this.player.fadeIn(0.6, start);
    }
    this.fading = this.fading.filter((f) => !f.stopped);
    for (const f of this.fading) f.schedule(until);
    this.player?.schedule(until);
    if (!this.player && this.fading.length === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const music = new Music();
