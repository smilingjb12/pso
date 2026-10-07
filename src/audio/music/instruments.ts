import { fm, group, midiHz, noise, tone, type V } from '../synth';

// Synth instruments for the music (and the jingles). Each plays one note:
// `m` is a MIDI note, `len` the held length in seconds, `vel` 0..1.

export type Instrument = (v: V, m: number, len: number, vel: number) => void;

const epiano: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  const d = Math.min(3, 0.9 + len * 0.9);
  fm(v, { f, ratio: 1, index: 1.1 * vel + 0.2, index1: 0.15, indexT: 0.9, a: 0.004, d, gain: 0.17 * vel, wet: 0.3 });
  // Tine: a short metallic attack.
  fm(v, { f, ratio: 14, index: 0.5, index1: 0.01, indexT: 0.12, d: 0.14, gain: 0.04 * vel });
};

const vibes: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  fm(v, { f, ratio: 4, index: 0.6, index1: 0.04, indexT: 0.5, a: 0.003, d: Math.min(2.6, 1.2 + len), gain: 0.16 * vel, wet: 0.45, vib: [5.5, 6, 0.1] });
  tone(v, { f: f * 2, d: 0.6, gain: 0.025 * vel });
};

const bell: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  fm(v, { f, ratio: 3.5, index: 1.6, index1: 0.08, indexT: 1.2, a: 0.002, d: Math.min(3.5, 1.8 + len), gain: 0.12 * vel, wet: 0.6 });
  tone(v, { f, d: Math.min(3, 1.5 + len), gain: 0.08 * vel, wet: 0.5 });
};

const pad: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  for (const det of [-9, 0, 9]) {
    tone(v, {
      type: 'sawtooth', f, detune: det, a: 0.5, d: 1, s: 0.8, r: 1.2, len, gain: 0.035 * vel, wet: 0.6,
      filter: { type: 'lowpass', f: 1300, q: 0.4 },
    });
  }
};

const darkpad: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  for (const det of [-7, 7]) {
    tone(v, {
      type: 'sawtooth', f, detune: det, a: 0.9, d: 1, s: 0.85, r: 1.8, len, gain: 0.05 * vel, wet: 0.7,
      filter: { type: 'lowpass', f: 520, q: 1.2 },
    });
  }
  tone(v, { type: 'sine', f: f / 2, a: 0.9, d: 1, s: 0.9, r: 1.8, len, gain: 0.06 * vel });
};

const strings: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  for (const det of [-6, 6]) {
    tone(v, {
      type: 'sawtooth', f, detune: det, a: 0.12, d: 0.4, s: 0.85, r: 0.35, len, gain: 0.045 * vel, wet: 0.5,
      filter: { type: 'lowpass', f: 2600, q: 0.5 }, vib: [5.2, 9, 0.25],
    });
  }
};

const choir: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  const g = group(v, { filter: { type: 'bandpass', f: 900, q: 0.9 }, wet: 0.7 });
  for (const det of [-10, 10]) {
    tone(g, { type: 'sawtooth', f, detune: det, a: 0.35, d: 0.6, s: 0.9, r: 0.8, len, gain: 0.08 * vel, vib: [4.8, 14, 0.3] });
  }
  tone(v, { type: 'triangle', f, a: 0.35, d: 0.6, s: 0.9, r: 0.8, len, gain: 0.05 * vel, wet: 0.6 });
};

const flute: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  tone(v, { type: 'sine', f, a: 0.06, d: 0.25, s: 0.85, r: 0.15, len, gain: 0.16 * vel, wet: 0.45, vib: [5, 14, 0.22] });
  tone(v, { type: 'triangle', f: f * 2, a: 0.05, d: 0.2, s: 0.4, r: 0.1, len, gain: 0.02 * vel });
  noise(v, { color: 'pink', a: 0.03, d: 0.12, gain: 0.04 * vel, filter: { type: 'bandpass', f: f * 2, q: 3 } });
};

const harp: Instrument = (v, m, _len, vel) => {
  const f = midiHz(m);
  tone(v, { type: 'triangle', f, d: 1.4, gain: 0.13 * vel, wet: 0.45, filter: { type: 'lowpass', f: 3400, f1: 900, fT: 0.6 } });
  tone(v, { type: 'sine', f: f * 2, d: 0.4, gain: 0.03 * vel });
};

const bass: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  tone(v, { type: 'sine', f, a: 0.008, d: 0.2, s: 0.8, r: 0.08, len, gain: 0.32 * vel });
  tone(v, { type: 'sawtooth', f, a: 0.008, d: 0.18, s: 0.5, r: 0.06, len, gain: 0.07 * vel, filter: { type: 'lowpass', f: 700, f1: 380, fT: 0.2 } });
};

const softbass: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  tone(v, { type: 'sine', f, a: 0.02, d: 0.4, s: 0.7, r: 0.12, len, gain: 0.3 * vel });
  tone(v, { type: 'triangle', f, a: 0.02, d: 0.3, s: 0.3, r: 0.1, len, gain: 0.08 * vel });
};

const pumpbass: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  tone(v, { type: 'sawtooth', f, a: 0.004, d: 0.14, s: 0.45, r: 0.05, len, gain: 0.14 * vel, filter: { type: 'lowpass', f: 1500, f1: 320, fT: 0.12, q: 2 } });
  tone(v, { type: 'sine', f, a: 0.004, d: 0.2, s: 0.8, r: 0.05, len, gain: 0.24 * vel });
};

const distbass: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  const g = group(v, { drive: 0.7, filter: { type: 'lowpass', f: 1300, q: 0.8 }, gain: 0.5 });
  tone(g, { type: 'sawtooth', f, a: 0.005, d: 0.2, s: 0.7, r: 0.06, len, gain: 0.25 * vel });
  tone(g, { type: 'square', f: f / 2, a: 0.005, d: 0.2, s: 0.6, r: 0.06, len, gain: 0.12 * vel });
  tone(v, { type: 'sine', f, a: 0.005, d: 0.2, s: 0.8, r: 0.06, len, gain: 0.18 * vel });
};

const brass: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  for (const det of [-7, 7]) {
    tone(v, {
      type: 'sawtooth', f, detune: det, a: 0.04, d: 0.3, s: 0.75, r: 0.12, len, gain: 0.06 * vel, wet: 0.35,
      filter: { type: 'lowpass', f: 500, f1: 2400 + vel * 1200, fT: 0.09, q: 1.1 }, vib: [5.5, 10, 0.3],
    });
  }
};

const lead: Instrument = (v, m, len, vel) => {
  const f = midiHz(m);
  tone(v, { type: 'square', f, a: 0.015, d: 0.3, s: 0.75, r: 0.12, len, gain: 0.05 * vel, wet: 0.35, vib: [5.6, 16, 0.2], filter: { type: 'lowpass', f: 3000, q: 0.8 } });
  tone(v, { type: 'sawtooth', f, detune: 8, a: 0.015, d: 0.3, s: 0.75, r: 0.12, len, gain: 0.04 * vel, vib: [5.6, 16, 0.2], filter: { type: 'lowpass', f: 3600 } });
};

const arp: Instrument = (v, m, _len, vel) => {
  const f = midiHz(m);
  tone(v, { type: 'square', f, d: 0.16, gain: 0.05 * vel, wet: 0.35, filter: { type: 'lowpass', f: 2800, f1: 900, fT: 0.15 } });
};

const stab: Instrument = (v, m, _len, vel) => {
  const f = midiHz(m);
  for (const det of [-8, 8]) {
    tone(v, { type: 'sawtooth', f, detune: det, a: 0.005, d: 0.22, gain: 0.07 * vel, wet: 0.4, filter: { type: 'lowpass', f: 3500, f1: 700, fT: 0.18, q: 1.5 } });
  }
};

// ---------------------------------------------------------------- drums

const kick: Instrument = (v, _m, _len, vel) => {
  tone(v, { f: 150, f1: 42, fT: 0.11, d: 0.4, gain: 0.85 * vel });
  noise(v, { d: 0.012, gain: 0.12 * vel, filter: { type: 'highpass', f: 3500 } });
};

const snare: Instrument = (v, _m, _len, vel) => {
  noise(v, { d: 0.17, gain: 0.3 * vel, wet: 0.3, filter: { type: 'bandpass', f: 2000, q: 0.7 } });
  tone(v, { type: 'triangle', f: 210, f1: 160, d: 0.09, gain: 0.3 * vel });
};

const hat: Instrument = (v, _m, _len, vel) => {
  noise(v, { d: 0.035, gain: 0.12 * vel, filter: { type: 'highpass', f: 7500 } });
};

const ohat: Instrument = (v, _m, _len, vel) => {
  noise(v, { d: 0.22, gain: 0.1 * vel, filter: { type: 'highpass', f: 6500 } });
};

const ride: Instrument = (v, _m, _len, vel) => {
  fm(v, { f: 520, ratio: 2.71, index: 2.5, index1: 0.6, indexT: 0.8, d: 1.1, gain: 0.025 * vel, wet: 0.3, filter: { type: 'highpass', f: 2500 } });
  noise(v, { d: 0.3, gain: 0.03 * vel, filter: { type: 'highpass', f: 7000 } });
};

const rim: Instrument = (v, _m, _len, vel) => {
  tone(v, { type: 'square', f: 1700, d: 0.025, gain: 0.08 * vel, filter: { type: 'bandpass', f: 1800, q: 4 } });
  noise(v, { d: 0.02, gain: 0.08 * vel, filter: { type: 'bandpass', f: 3000, q: 2 } });
};

const brush: Instrument = (v, _m, _len, vel) => {
  noise(v, { a: 0.02, d: 0.13, gain: 0.08 * vel, filter: { type: 'bandpass', f: 3500, q: 0.8 } });
};

const shaker: Instrument = (v, _m, _len, vel) => {
  noise(v, { a: 0.012, d: 0.06, gain: 0.07 * vel, filter: { type: 'highpass', f: 5200 } });
};

const tom: Instrument = (v, m, _len, vel) => {
  const f = midiHz(m);
  tone(v, { f: f * 1.5, f1: f, fT: 0.08, d: 0.45, gain: 0.55 * vel, wet: 0.35 });
  noise(v, { d: 0.05, gain: 0.08 * vel, filter: { type: 'bandpass', f: 500, q: 1 } });
};

const taiko: Instrument = (v, m, _len, vel) => {
  const f = midiHz(m);
  tone(v, { f: f * 1.6, f1: f, fT: 0.1, d: 0.75, gain: 0.7 * vel, wet: 0.5 });
  noise(v, { color: 'brown', d: 0.18, gain: 0.35 * vel, filter: { type: 'lowpass', f: 380 } });
};

const crash: Instrument = (v, _m, _len, vel) => {
  noise(v, { d: 1.7, gain: 0.13 * vel, wet: 0.4, filter: { type: 'highpass', f: 3200 } });
  fm(v, { f: 410, ratio: 3.17, index: 4, index1: 1, d: 1.4, gain: 0.02 * vel, filter: { type: 'highpass', f: 3000 } });
};

const timpani: Instrument = (v, m, _len, vel) => {
  const f = midiHz(m);
  tone(v, { f: f * 1.15, f1: f, fT: 0.06, d: 1.3, gain: 0.5 * vel, wet: 0.5 });
  noise(v, { color: 'brown', d: 0.12, gain: 0.25 * vel, filter: { type: 'lowpass', f: 300 } });
};

export const INSTRUMENTS = {
  epiano, vibes, bell, pad, darkpad, strings, choir, flute, harp,
  bass, softbass, pumpbass, distbass, brass, lead, arp, stab,
  kick, snare, hat, ohat, ride, rim, brush, shaker, tom, taiko, crash, timpani,
} satisfies Record<string, Instrument>;

export type InstId = keyof typeof INSTRUMENTS;
