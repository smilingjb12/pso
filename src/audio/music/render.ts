import { impulse } from '../engine';
import type { V } from '../synth';
import { INSTRUMENTS } from './instruments';
import type { Layer } from './theory';
import type { Track } from './tracks';

// Offline render of a synth track to a loopable recording (a dev tool: see
// tracks.ts cavesBattle). Same instruments, pans and music hall as the live
// sequencer; the render runs one loop plus `tail` seconds of the next, which
// is what the recorded-loop player folds over the seam.

export async function renderLayer(track: Track, layer: Layer, tail = 3, rate = 44100): Promise<AudioBuffer> {
  const stepDur = 60 / track.bpm / 4;
  const loopSteps = track.bars * 16;
  const loopSec = loopSteps * stepDur;
  const total = loopSec + tail;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  const hall = ctx.createConvolver();
  hall.buffer = impulse(ctx, 3, 2.2);
  hall.connect(out);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  wet.connect(hall);
  const swing = track.swing ?? 0;
  for (const part of track.parts) {
    if (part.layer !== 'base' && part.layer !== layer) continue;
    let dest: AudioNode = out;
    if (part.pan) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = part.pan;
      pan.connect(out);
      dest = pan;
    }
    for (let k = 0; k * loopSec < total; k++) {
      for (const ev of part.notes) {
        const t = (k * loopSteps + ev.s) * stepDur + (swing && ev.s % 4 === 2 ? swing * stepDur * 2 : 0);
        if (t >= total) continue;
        const v: V = { ctx, out: dest, wet, t, p: 1 };
        INSTRUMENTS[part.inst](v, ev.n, ev.l * stepDur * 0.92, ev.v * (part.gain ?? 1));
      }
    }
  }
  return ctx.startRendering();
}

/** 16-bit PCM WAV, peak-normalised to -1 dBFS. */
export function toWav(buf: AudioBuffer): Blob {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  let peak = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const scale = peak > 0 ? 0.891 / peak : 1;
  const n = buf.length * chans.length;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, chans.length, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * chans.length * 2, true);
  view.setUint16(32, chans.length * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < buf.length; i++) {
    for (const d of chans) {
      view.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(d[i] * scale * 32767))), true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
