import { INSTRUMENTS, type InstId } from './music/instruments';
import { note } from './music/theory';
import { fm, group, later, noise, pitched, tone, type V } from './synth';

// Every sound effect, as small synthesis recipes. Most have 2-3 variants to
// audition in /soundlab.html; the game plays the variant chosen in picks.ts.
// `x` is an optional per-call argument (duration of a breath / beam, ...).

export type SfxGroup = 'Combat' | 'Techniques' | 'Player' | 'Enemies' | 'Dragon' | 'De Rol Le' | 'Mines' | 'Warden' | 'World' | 'Loot' | 'UI' | 'Jingles';

export interface Variant {
  name: string;
  desc: string;
  play: (v: V, x: number) => void;
}

export interface SfxDef {
  group: SfxGroup;
  label: string;
  variants: Variant[];
  /** Seconds before the voice is cleaned up (default 3). */
  len?: number;
  /** Min seconds between two plays (default 0.03). */
  gap?: number;
  /** Max overlapping plays (default 4). */
  max?: number;
  /** Distance where it starts to fade (default 8 m). */
  ref?: number;
  /** Plays on the music bus and ducks the music for this long. */
  duck?: number;
  /** Default `x` argument. */
  x?: number;
  /** Random pitch spread (default 0.04). */
  jitter?: number;
}

const v_ = (name: string, desc: string, play: Variant['play']): Variant => ({ name, desc, play });

/** Play instrument notes: [seconds, note, length, velocity]. */
function score(v: V, inst: InstId, notes: [number, string, number, number?][]): void {
  for (const [t, n, len, vel] of notes) INSTRUMENTS[inst](later(v, t), note(n), len, vel ?? 0.8);
}

/** A run of short FM pings (sparkles, ice, glass). */
function sparkle(v: V, freqs: number[], step: number, gain = 0.06, d = 0.5, ratio = 3.01): void {
  freqs.forEach((f, i) => fm(v, { f, ratio, index: 1.2, index1: 0.05, d, gain, at: i * step, wet: 0.6 }));
}

function bubbles(v: V, n: number, span: number, gain = 0.08, lo = 300, hi = 800): void {
  for (let i = 0; i < n; i++) {
    const f = lo + Math.random() * (hi - lo);
    tone(v, { f, f1: f * 1.8, d: 0.05 + Math.random() * 0.04, gain, at: Math.random() * span });
  }
}

// --------------------------------------------------------- shared bits

const swoosh = (v: V, lo: number, hi: number, d: number, gain: number, at = 0) =>
  noise(v, { color: 'pink', a: d * 0.3, d: d * 0.7, gain, at, filter: { type: 'bandpass', f: lo, f1: hi, fT: d * 0.6, q: 1.3 } });

const thump = (v: V, f: number, d: number, gain: number, at = 0) => tone(v, { f, f1: f * 0.35, fT: d * 0.8, d, gain, at });

const crack = (v: V, d: number, gain: number, f = 2500, at = 0) =>
  noise(v, { d, gain, at, filter: { type: 'bandpass', f, q: 0.8 } });

const rumble = (v: V, d: number, gain: number, f = 500, a = 0.01, at = 0) =>
  noise(v, { color: 'brown', a, d, gain, at, filter: { type: 'lowpass', f, f1: f * 0.4, fT: d } });

const explosion = (v: V, size: number, gain = 0.7) => {
  rumble(v, 0.5 * size + 0.3, gain, 2400);
  thump(v, 90, 0.45 * size, gain * 0.8);
  noise(v, { d: 0.18, gain: gain * 0.35, filter: { type: 'highpass', f: 2800 }, wet: 0.4 });
};

const slam = (v: V, gain = 0.85) => {
  thump(v, 75, 0.9, gain);
  rumble(v, 1.1, gain * 0.9, 650);
  crack(v, 0.08, gain * 0.4, 1800);
  for (let i = 0; i < 5; i++) noise(v, { d: 0.05, gain: 0.08, at: 0.12 + i * 0.07 + Math.random() * 0.05, filter: { type: 'bandpass', f: 900 + Math.random() * 1500, q: 2 } });
};

const growl = (v: V, f: number, d: number, gain: number, rough = 30) => {
  const g = group(v, { drive: 0.6, filter: { type: 'bandpass', f: f * 5, q: 0.9 }, wet: 0.3 });
  tone(g, { type: 'sawtooth', f, f1: f * 0.8, a: 0.06, d, gain, vib: [rough, 60] });
  rumble(v, d, gain * 0.7, 700, 0.05);
};

// ------------------------------------------------------------- catalogue

const DEFS = {
  // ================================================================ Combat
  'swing.blade': {
    group: 'Combat', label: 'Swing: blade (saber, sword, dagger, partisan)', gap: 0.05,
    variants: [
      v_('Swish', 'Clean air swish', (v) => swoosh(v, 600, 2600, 0.2, 0.35)),
      v_('Photon hum', 'Swish plus a rising photon-blade hum, like PSO sabers', (v) => {
        swoosh(v, 700, 2400, 0.18, 0.25);
        tone(v, { type: 'sawtooth', f: 95, f1: 150, a: 0.03, d: 0.22, gain: 0.12, filter: { type: 'lowpass', f: 500, f1: 2200, fT: 0.12, q: 3 } });
      }),
      v_('Ringing', 'Swish with a faint metallic ring', (v) => {
        swoosh(v, 900, 3200, 0.18, 0.3);
        fm(v, { f: 1800, ratio: 2.41, index: 0.6, d: 0.3, gain: 0.03, at: 0.03, wet: 0.4 });
      }),
    ],
  },
  'swing.blunt': {
    group: 'Combat', label: 'Swing: staff (cane, rod, wand)', gap: 0.05,
    variants: [
      v_('Whoosh', 'Low, heavy whoosh', (v) => swoosh(v, 300, 1100, 0.26, 0.4)),
      v_('Whir', 'Whoosh with a staff whir', (v) => {
        swoosh(v, 350, 1300, 0.24, 0.3);
        tone(v, { type: 'triangle', f: 220, f1: 330, a: 0.05, d: 0.2, gain: 0.06, vib: [24, 80] });
      }),
    ],
  },
  'hit.normal': {
    group: 'Combat', label: 'Hit', gap: 0.02, max: 6,
    variants: [
      v_('Thwack', 'Punchy body thump with a snap', (v) => {
        crack(v, 0.07, 0.45, 1600);
        thump(v, 190, 0.13, 0.55);
      }),
      v_('Crunch', 'Grittier, with a click on top', (v) => {
        noise(v, { color: 'pink', d: 0.12, gain: 0.45, filter: { type: 'lowpass', f: 3000, f1: 600 } });
        tone(v, { type: 'square', f: 130, f1: 50, d: 0.08, gain: 0.25, filter: { type: 'lowpass', f: 800 } });
        noise(v, { d: 0.015, gain: 0.25, filter: { type: 'highpass', f: 5000 } });
      }),
      v_('Digital slash', 'Dreamcast-style synthetic hit', (v) => {
        fm(v, { f: 900, f1: 280, ratio: 1.5, index: 4, index1: 0.5, d: 0.12, gain: 0.22 });
        crack(v, 0.05, 0.3, 2600);
      }),
    ],
  },
  'hit.heavy': {
    group: 'Combat', label: 'Hit: heavy / finisher', gap: 0.03, max: 4,
    variants: [
      v_('Deep thump', 'Lower and longer than a normal hit', (v) => {
        thump(v, 150, 0.26, 0.7);
        noise(v, { color: 'pink', d: 0.18, gain: 0.45, filter: { type: 'lowpass', f: 1800, f1: 400 } });
        crack(v, 0.04, 0.3, 3000);
      }),
      v_('Crunchy', 'Distorted impact', (v) => {
        const g = group(v, { drive: 0.8, filter: { type: 'lowpass', f: 3500 } });
        thump(g, 160, 0.22, 0.6);
        noise(g, { color: 'pink', d: 0.16, gain: 0.4 });
      }),
    ],
  },
  'hit.crit': {
    group: 'Combat', label: 'Hit: critical', gap: 0.04,
    variants: [
      v_('Hit + ping', 'A heavy hit with a bright ping', (v) => {
        thump(v, 170, 0.2, 0.6);
        crack(v, 0.06, 0.4, 2200);
        fm(v, { f: 2350, ratio: 3.01, index: 1.5, index1: 0.05, d: 0.45, gain: 0.08, wet: 0.5 });
      }),
      v_('Hit + shing', 'Heavy hit with a metallic shing', (v) => {
        thump(v, 170, 0.2, 0.6);
        noise(v, { a: 0.01, d: 0.3, gain: 0.18, filter: { type: 'bandpass', f: 6000, f1: 3000, q: 4 }, wet: 0.4 });
      }),
    ],
  },
  'hit.special': {
    group: 'Combat', label: 'Weapon special procs', gap: 0.05,
    variants: [
      v_('Arpeggio', 'Three quick rising chimes', (v) => sparkle(v, [880, 1320, 1760], 0.045, 0.07, 0.35, 2)),
      v_('Whoosh chime', 'Rising whoosh into a chime', (v) => {
        noise(v, { a: 0.1, d: 0.1, gain: 0.15, filter: { type: 'bandpass', f: 800, f1: 4000, fT: 0.15, q: 2 } });
        fm(v, { f: 1568, ratio: 2, index: 1, d: 0.5, gain: 0.08, at: 0.12, wet: 0.5 });
      }),
    ],
  },
  'hit.miss': {
    group: 'Combat', label: 'Miss', gap: 0.05,
    variants: [
      v_('Whiff tick', 'Light swish and tick', (v) => {
        crack(v, 0.05, 0.1, 3200);
        tone(v, { f: 1300, f1: 900, d: 0.07, gain: 0.07 });
      }),
      v_('Low blip', 'Soft retro blip', (v) => tone(v, { type: 'square', f: 300, f1: 200, d: 0.09, gain: 0.08, filter: { type: 'lowpass', f: 1300 } })),
    ],
  },
  'combo.window': {
    group: 'Combat', label: 'Combo timing window opens', gap: 0.1,
    variants: [
      v_('Soft ping', 'Gentle FM ping', (v) => fm(v, { f: 1568, ratio: 2, index: 0.5, d: 0.25, gain: 0.1, wet: 0.3 })),
      v_('Glass tick', 'Tiny high glassy tick', (v) => {
        tone(v, { f: 2093, d: 0.1, gain: 0.08 });
        tone(v, { f: 3136, d: 0.07, gain: 0.04 });
      }),
      v_('Low chime', 'Rounder, lower chime', (v) => tone(v, { type: 'triangle', f: 1047, d: 0.22, gain: 0.12, wet: 0.3 })),
    ],
  },
  'combo.perfect': {
    group: 'Combat', label: 'Perfect chain', gap: 0.08,
    variants: [
      v_('Bright chime', 'Two-note rising chime', (v) => {
        tone(v, { f: 1568, d: 0.12, gain: 0.09 });
        tone(v, { f: 2349, d: 0.18, gain: 0.07, wet: 0.3, at: 0.05 });
      }),
      v_('Spark', 'Sparkly FM shimmer', (v) => sparkle(v, [2093, 2637, 3136], 0.03, 0.05, 0.3)),
      v_('Crisp ting', 'Short metallic ting', (v) => fm(v, { f: 2637, ratio: 3.5, index: 1.2, d: 0.16, gain: 0.08, wet: 0.2 })),
    ],
  },
  'combo.early': {
    group: 'Combat', label: 'Combo broken (pressed too early)', gap: 0.1,
    variants: [
      v_('Buzz', 'Short dull buzz', (v) => tone(v, { type: 'square', f: 110, d: 0.13, gain: 0.12, filter: { type: 'lowpass', f: 650 } })),
      v_('Thunk', 'Wooden thunk', (v) => {
        tone(v, { f: 200, f1: 120, d: 0.1, gain: 0.3 });
        noise(v, { d: 0.05, gain: 0.12, filter: { type: 'lowpass', f: 600 } });
      }),
    ],
  },
  'shot.handgun': {
    group: 'Combat', label: 'Shot: handgun', gap: 0.04,
    variants: [
      v_('Photon pistol', 'Snappy zap with a little body', (v) => {
        tone(v, { type: 'square', f: 1400, f1: 200, fT: 0.09, d: 0.12, gain: 0.12, filter: { type: 'lowpass', f: 4000 } });
        noise(v, { d: 0.04, gain: 0.18, filter: { type: 'highpass', f: 2000 } });
        thump(v, 130, 0.08, 0.3);
      }),
      v_('Laser blip', 'Pure sci-fi laser', (v) => fm(v, { f: 1800, f1: 380, ratio: 0.5, index: 3, d: 0.12, gain: 0.16 })),
      v_('Snappy', 'Short crack and chirp', (v) => {
        crack(v, 0.03, 0.3, 3500);
        tone(v, { type: 'sawtooth', f: 900, f1: 150, d: 0.08, gain: 0.08, filter: { type: 'lowpass', f: 3000 } });
      }),
    ],
  },
  'shot.rifle': {
    group: 'Combat', label: 'Shot: rifle', gap: 0.05,
    variants: [
      v_('Rail crack', 'Long descending crack with a thump', (v) => {
        tone(v, { type: 'sawtooth', f: 2400, f1: 110, fT: 0.25, d: 0.3, gain: 0.12, filter: { type: 'lowpass', f: 6000, f1: 700 }, wet: 0.4 });
        noise(v, { d: 0.12, gain: 0.3, filter: { type: 'highpass', f: 1500 } });
        thump(v, 100, 0.15, 0.45);
      }),
      v_('Beam', 'FM beam with a long tail', (v) => {
        fm(v, { f: 1200, f1: 200, ratio: 0.5, index: 5, index1: 1, d: 0.35, gain: 0.15, wet: 0.5 });
        thump(v, 90, 0.12, 0.35);
      }),
    ],
  },
  'shot.mechgun': {
    group: 'Combat', label: 'Shot: mechgun (3-round burst)', gap: 0.05,
    variants: [
      v_('Pops', 'Three tight pops', (v) => {
        for (let i = 0; i < 3; i++) {
          crack(v, 0.035, 0.28, 2400, i * 0.06);
          tone(v, { type: 'square', f: 700, f1: 180, d: 0.05, gain: 0.07, at: i * 0.06, filter: { type: 'lowpass', f: 2500 } });
          thump(v, 140, 0.06, 0.2, i * 0.06);
        }
      }),
      v_('Buzz burst', 'Buzzy sci-fi burst', (v) => {
        for (let i = 0; i < 3; i++) fm(v, { f: 1100, f1: 400, ratio: 0.5, index: 4, d: 0.06, gain: 0.12, at: i * 0.06 });
      }),
    ],
  },
  'shot.shot': {
    group: 'Combat', label: 'Shot: shot (5-pellet spread)', gap: 0.08,
    variants: [
      v_('Blast', 'Wide shotgun-like blast', (v) => {
        noise(v, { color: 'pink', d: 0.32, gain: 0.55, filter: { type: 'lowpass', f: 3200, f1: 500 }, wet: 0.3 });
        thump(v, 110, 0.25, 0.5);
      }),
      v_('Spread laser', 'Five detuned laser chirps at once', (v) => {
        for (let i = 0; i < 5; i++) fm(v, { f: 1300 + i * 140, f1: 300 + i * 30, ratio: 0.5, index: 3, d: 0.14, gain: 0.06, at: i * 0.008 });
        thump(v, 120, 0.12, 0.3);
      }),
    ],
  },
  'shot.slicer': {
    group: 'Combat', label: 'Shot: slicer (thrown disc)', gap: 0.08,
    variants: [
      v_('Whir', 'Spinning disc whir', (v) => {
        tone(v, { type: 'sawtooth', f: 320, f1: 520, a: 0.04, d: 0.42, gain: 0.07, vib: [32, 300], filter: { type: 'lowpass', f: 1800 } });
        swoosh(v, 500, 1800, 0.3, 0.2);
      }),
      v_('FM whirr', 'Choppy metallic whirr', (v) => fm(v, { f: 600, f1: 900, ratio: 0.05, index: 18, a: 0.03, d: 0.45, gain: 0.1 })),
    ],
  },
  'box.break': {
    group: 'Combat', label: 'Container breaks', gap: 0.05,
    variants: [
      v_('Metal crate', 'Clang and rattle', (v) => {
        fm(v, { f: 300, ratio: 1.41, index: 3, index1: 0.2, d: 0.45, gain: 0.2, wet: 0.3 });
        rumble(v, 0.3, 0.3, 1500);
        for (let i = 0; i < 4; i++) fm(v, { f: 700 + Math.random() * 900, ratio: 2.3, index: 1.5, d: 0.12, gain: 0.06, at: 0.08 + i * 0.06 });
      }),
      v_('Wood crack', 'Splintering crate', (v) => {
        noise(v, { d: 0.3, gain: 0.35, filter: { type: 'bandpass', f: 1300, f1: 400, q: 1.2 } });
        for (let i = 0; i < 4; i++) tone(v, { type: 'triangle', f: 250 + i * 40, f1: 150, d: 0.07, gain: 0.15, at: 0.03 + i * 0.05 });
        thump(v, 90, 0.2, 0.3);
      }),
    ],
  },

  // ============================================================ Techniques
  'tech.charge': {
    group: 'Techniques', label: 'Technique: casting', gap: 0.1,
    variants: [
      v_('Rising shimmer', 'Rising FM shimmer', (v) => {
        fm(v, { f: 400, f1: 1200, ratio: 2, index: 1, a: 0.25, d: 0.35, gain: 0.1, wet: 0.5 });
        noise(v, { a: 0.2, d: 0.3, gain: 0.05, filter: { type: 'highpass', f: 4000 } });
      }),
      v_('Choir hum', 'Soft three-voice hum', (v) => {
        for (const f of [523, 659, 784]) tone(v, { type: 'triangle', f, a: 0.25, d: 0.45, gain: 0.04, vib: [5, 10], wet: 0.6 });
      }),
    ],
  },
  'tech.foie': {
    group: 'Techniques', label: 'Foie: fireball launch', gap: 0.08,
    variants: [
      v_('Whoomp', 'Fiery whoomp', (v) => {
        noise(v, { color: 'brown', a: 0.03, d: 0.4, gain: 0.55, filter: { type: 'lowpass', f: 700, f1: 2600, fT: 0.15 } });
        tone(v, { type: 'sawtooth', f: 220, f1: 80, d: 0.3, gain: 0.07, filter: { type: 'lowpass', f: 900 } });
      }),
      v_('Crackle', 'Whoosh with crackles', (v) => {
        swoosh(v, 400, 2000, 0.35, 0.35);
        for (let i = 0; i < 6; i++) crack(v, 0.015, 0.12, 3000 + Math.random() * 3000, Math.random() * 0.35);
      }),
    ],
  },
  'tech.foie.hit': {
    group: 'Techniques', label: 'Foie: explosion', gap: 0.05,
    variants: [
      v_('Burst', 'Fiery burst', (v) => explosion(v, 0.8, 0.55)),
      v_('Crackling burst', 'Burst with lingering crackle', (v) => {
        explosion(v, 0.7, 0.45);
        for (let i = 0; i < 8; i++) crack(v, 0.012, 0.1, 2500 + Math.random() * 4000, 0.05 + Math.random() * 0.5);
      }),
    ],
  },
  'tech.zonde': {
    group: 'Techniques', label: 'Zonde: lightning strike', gap: 0.05,
    variants: [
      v_('Thunder crack', 'Crack and rumble', (v) => {
        noise(v, { d: 0.05, gain: 0.55, filter: { type: 'highpass', f: 1500 } });
        noise(v, { d: 0.35, gain: 0.3, filter: { type: 'bandpass', f: 3200, f1: 700, q: 0.8 }, wet: 0.4 });
        rumble(v, 0.9, 0.45, 450, 0.05, 0.03);
      }),
      v_('Electric zap', 'Buzzy electric zap', (v) => {
        fm(v, { f: 120, ratio: 7.3, index: 8, index1: 1, d: 0.35, gain: 0.18 });
        noise(v, { d: 0.05, gain: 0.4, filter: { type: 'highpass', f: 2000 } });
      }),
    ],
  },
  'tech.barta': {
    group: 'Techniques', label: 'Barta: ice wave', gap: 0.08,
    variants: [
      v_('Crystal wave', 'Hiss with crystalline pings', (v) => {
        noise(v, { a: 0.03, d: 0.6, gain: 0.25, filter: { type: 'highpass', f: 5000, f1: 2000 }, wet: 0.4 });
        sparkle(v, [2637, 3520, 2960, 3951], 0.06, 0.05, 0.4, 3.7);
      }),
      v_('Frost hiss', 'Cold descending hiss with a low swell', (v) => {
        noise(v, { a: 0.05, d: 0.6, gain: 0.25, filter: { type: 'bandpass', f: 7000, f1: 2500, q: 2 } });
        tone(v, { f: 180, f1: 120, a: 0.05, d: 0.4, gain: 0.2 });
      }),
    ],
  },
  'tech.resta': {
    group: 'Techniques', label: 'Resta / healing', gap: 0.1,
    variants: [
      v_('Rising bells', 'Major arpeggio of bells', (v) => sparkle(v, [1047, 1319, 1568, 2093], 0.07, 0.07, 0.8, 2)),
      v_('Shimmer', 'Soft shimmering chord', (v) => {
        for (const f of [784, 988, 1175]) tone(v, { type: 'triangle', f, a: 0.08, d: 0.8, gain: 0.05, vib: [6, 12], wet: 0.6 });
      }),
    ],
  },
  'tech.buff': {
    group: 'Techniques', label: 'Shifta / Deband (buff)', gap: 0.1,
    variants: [
      v_('Power up', 'Three rising tones', (v) => {
        [392, 523, 784].forEach((f, i) => tone(v, { type: 'square', f, d: 0.12, gain: 0.06, at: i * 0.07, filter: { type: 'lowpass', f: 2500 } }));
      }),
      v_('Sweep', 'Rising sweep into a ping', (v) => {
        tone(v, { type: 'sawtooth', f: 200, f1: 800, a: 0.2, d: 0.1, gain: 0.06, filter: { type: 'lowpass', f: 1200, f1: 4000 } });
        fm(v, { f: 1568, ratio: 2, index: 0.8, d: 0.4, gain: 0.08, at: 0.25, wet: 0.5 });
      }),
    ],
  },
  'status.freeze': {
    group: 'Techniques', label: 'Enemy frozen', gap: 0.1,
    variants: [
      v_('Ice crackle', 'Crackling freeze', (v) => {
        sparkle(v, [3200, 2600, 3600], 0.03, 0.04, 0.25, 3.7);
        noise(v, { d: 0.25, gain: 0.15, filter: { type: 'highpass', f: 4000 } });
      }),
      v_('Clink', 'Single glassy clink', (v) => fm(v, { f: 2800, ratio: 3.7, index: 2, index1: 0.1, d: 0.4, gain: 0.07, wet: 0.4 })),
    ],
  },

  // ================================================================ Player
  'player.hurt': {
    group: 'Player', label: 'Player hit', gap: 0.1,
    variants: [
      v_('Thud + grunt', 'Body thud with a short voiced grunt', (v) => {
        thump(v, 160, 0.15, 0.6);
        noise(v, { d: 0.1, gain: 0.25, filter: { type: 'lowpass', f: 1200 } });
        fm(v, { f: 330, f1: 250, ratio: 1, index: 2, d: 0.12, gain: 0.08, filter: { type: 'bandpass', f: 1000, q: 1.5 } });
      }),
      v_('Impact', 'Heavier, no voice', (v) => {
        noise(v, { color: 'pink', d: 0.2, gain: 0.4, filter: { type: 'bandpass', f: 800, q: 0.8 } });
        thump(v, 140, 0.2, 0.6);
      }),
    ],
  },
  'player.dodge': {
    group: 'Player', label: 'Enemy attack misses you', gap: 0.1,
    variants: [
      v_('Whoosh', 'Soft whoosh past', (v) => swoosh(v, 1200, 500, 0.18, 0.15)),
      v_('Tick', 'Tiny tick', (v) => tone(v, { f: 1000, f1: 1300, d: 0.05, gain: 0.05 })),
    ],
  },
  'player.dash': {
    group: 'Player', label: 'Dash', gap: 0.05,
    variants: [
      v_('Photon whoosh', 'Falling whoosh with a soft photon chirp', (v) => {
        swoosh(v, 2400, 700, 0.22, 0.4);
        tone(v, { type: 'triangle', f: 1400, f1: 2100, d: 0.09, gain: 0.04 });
      }),
      v_('Air burst', 'Short low push of air, no tone', (v) => {
        swoosh(v, 500, 1600, 0.2, 0.45);
        thump(v, 120, 0.1, 0.25);
      }),
      v_('Thruster', 'Brief jet hiss, like a boost pack', (v) => {
        noise(v, { a: 0.01, d: 0.24, gain: 0.25, filter: { type: 'highpass', f: 1800, f1: 900, fT: 0.2 } });
        tone(v, { type: 'sawtooth', f: 160, f1: 90, d: 0.18, gain: 0.05, filter: { type: 'lowpass', f: 900 } });
      }),
    ],
  },
  'player.death': {
    group: 'Player', label: 'Player falls', gap: 0.5,
    variants: [
      v_('Fall', 'Descending tone and a thud', (v) => {
        tone(v, { type: 'square', f: 440, f1: 110, d: 0.9, gain: 0.06, filter: { type: 'lowpass', f: 1500 } });
        thump(v, 110, 0.3, 0.5, 0.5);
      }),
      v_('Collapse', 'Thud and a fading shimmer', (v) => {
        thump(v, 120, 0.3, 0.55);
        sparkle(v, [1568, 1319, 1047, 784], 0.12, 0.04, 0.6, 2);
      }),
    ],
  },
  'player.revive': {
    group: 'Player', label: 'Revived (Scape Doll, Moon Atomizer)', gap: 0.5,
    variants: [
      v_('Sparkle', 'Ascending sparkle with a pad', (v) => {
        sparkle(v, [784, 1047, 1319, 1568, 2093], 0.08, 0.06, 0.9, 2);
        for (const f of [392, 494, 587]) tone(v, { type: 'triangle', f, a: 0.3, d: 1.2, gain: 0.04, wet: 0.6 });
      }),
      v_('Chime', 'Single warm chime', (v) => fm(v, { f: 1047, ratio: 3.5, index: 1.5, index1: 0.05, d: 1.6, gain: 0.12, wet: 0.6 })),
    ],
  },
  'status.poison': {
    group: 'Player', label: 'Poisoned', gap: 0.3,
    variants: [
      v_('Bubbles', 'Sickly bubbling', (v) => bubbles(v, 8, 0.35, 0.08, 250, 600)),
      v_('Gurgle', 'Low gurgle', (v) => tone(v, { type: 'triangle', f: 160, f1: 110, d: 0.4, gain: 0.15, vib: [14, 120] })),
    ],
  },
  'status.paralysis': {
    group: 'Player', label: 'Paralysed', gap: 0.3,
    variants: [
      v_('Buzz', 'Electric buzz with crackles', (v) => {
        fm(v, { type: 'sawtooth', f: 60, ratio: 3, index: 3, d: 0.5, gain: 0.07, filter: { type: 'lowpass', f: 2500 } });
        for (let i = 0; i < 5; i++) crack(v, 0.012, 0.15, 4000, Math.random() * 0.4);
      }),
      v_('Zap', 'Short zap', (v) => fm(v, { f: 150, ratio: 7.3, index: 6, index1: 0.5, d: 0.3, gain: 0.14 })),
    ],
  },
  'status.burn': {
    group: 'Player', label: 'Burning (new stacks)', gap: 0.35,
    variants: [
      v_('Ignite', 'Whoomp of catching fire', (v) => {
        swoosh(v, 250, 1400, 0.4, 0.25);
        for (let i = 0; i < 6; i++) crack(v, 0.01, 0.08, 3000 + Math.random() * 2500, 0.05 + Math.random() * 0.3);
      }),
      v_('Sizzle', 'Hot sizzle', (v) => noise(v, { a: 0.02, d: 0.45, gain: 0.14, filter: { type: 'highpass', f: 3500, f1: 6000 } })),
    ],
  },
  'item.drink': {
    group: 'Player', label: 'Use a recovery item', gap: 0.2,
    variants: [
      v_('Gulp + sparkle', 'Two gulps and a sparkle', (v) => {
        tone(v, { f: 300, f1: 520, d: 0.08, gain: 0.15 });
        tone(v, { f: 320, f1: 560, d: 0.08, gain: 0.15, at: 0.14 });
        sparkle(v, [1319, 1661, 1976], 0.05, 0.05, 0.5, 2);
      }),
      v_('Heal chime', 'Bright three-note chime', (v) => sparkle(v, [1319, 1661, 1976], 0.06, 0.07, 0.6, 2)),
    ],
  },
  'step.grass': {
    group: 'Player', label: 'Footstep: grass', gap: 0.1, jitter: 0.12,
    variants: [
      v_('Soft', 'Muffled step with a little rustle', (v) => {
        noise(v, { color: 'pink', d: 0.07, gain: 0.1, filter: { type: 'lowpass', f: 900 } });
        noise(v, { a: 0.01, d: 0.04, gain: 0.025, filter: { type: 'highpass', f: 3500 } });
      }),
      v_('Crunchy', 'Leafier step', (v) => noise(v, { a: 0.005, d: 0.09, gain: 0.07, filter: { type: 'bandpass', f: 2200, q: 0.6 } })),
    ],
  },
  'step.stone': {
    group: 'Player', label: 'Footstep: stone', gap: 0.1, jitter: 0.12,
    variants: [
      v_('Tap', 'Hard tap', (v) => {
        noise(v, { d: 0.035, gain: 0.09, filter: { type: 'bandpass', f: 1800, q: 2 } });
        thump(v, 150, 0.05, 0.07);
      }),
      v_('Gritty', 'Tap with grit', (v) => {
        noise(v, { d: 0.05, gain: 0.07, filter: { type: 'bandpass', f: 2600, q: 1 } });
        thump(v, 120, 0.06, 0.08);
      }),
    ],
  },
  'step.metal': {
    group: 'Player', label: 'Footstep: metal deck (Pioneer 2)', gap: 0.1, jitter: 0.1,
    variants: [
      v_('Clank', 'Light metallic clank', (v) => {
        fm(v, { f: 380, ratio: 1.41, index: 1.5, index1: 0.1, d: 0.08, gain: 0.05 });
        noise(v, { d: 0.03, gain: 0.05, filter: { type: 'bandpass', f: 2500 } });
      }),
      v_('Muted', 'Duller deck step', (v) => {
        thump(v, 170, 0.06, 0.1);
        noise(v, { d: 0.03, gain: 0.04, filter: { type: 'bandpass', f: 1500 } });
      }),
    ],
  },
  'step.wood': {
    group: 'Player', label: 'Footstep: wooden raft', gap: 0.1, jitter: 0.1,
    variants: [
      v_('Knock', 'Hollow wooden knock', (v) => {
        tone(v, { type: 'triangle', f: 180, f1: 140, d: 0.06, gain: 0.12 });
        noise(v, { d: 0.04, gain: 0.05, filter: { type: 'bandpass', f: 700 } });
      }),
      v_('Creak', 'Knock with a tiny creak', (v) => {
        tone(v, { type: 'triangle', f: 170, f1: 140, d: 0.06, gain: 0.1 });
        tone(v, { type: 'sawtooth', f: 420, f1: 380, d: 0.08, gain: 0.015, at: 0.03, filter: { type: 'bandpass', f: 900, q: 3 } });
      }),
    ],
  },

  // =============================================================== Enemies
  'enemy.spawn': {
    group: 'Enemies', label: 'Enemy warps in', gap: 0.08, max: 3,
    variants: [
      v_('Warp in', 'Rising FM warp', (v) => {
        fm(v, { f: 200, f1: 1100, ratio: 0.5, index: 2, a: 0.3, d: 0.45, gain: 0.1, wet: 0.5 });
        noise(v, { a: 0.4, d: 0.25, gain: 0.06, filter: { type: 'highpass', f: 1000, f1: 6000, fT: 0.6 } });
      }),
      v_('Materialize', 'Rising square blips', (v) => {
        [262, 330, 392, 523, 659].forEach((f, i) => tone(v, { type: 'square', f, d: 0.08, gain: 0.04, at: i * 0.1, filter: { type: 'lowpass', f: 2000 } }));
      }),
    ],
  },
  'enemy.ambush': {
    group: 'Enemies', label: 'Ambush warning', gap: 0.5,
    variants: [
      v_('Alarm', 'Two-tone alarm', (v) => {
        for (let i = 0; i < 4; i++) tone(v, { type: 'square', f: i % 2 ? 660 : 880, d: 0.14, h: 0.06, gain: 0.07, at: i * 0.2, filter: { type: 'lowpass', f: 2200 } });
      }),
      v_('Ominous swell', 'Low rising swell', (v) => {
        tone(v, { type: 'sawtooth', f: 55, f1: 110, a: 0.6, d: 0.4, gain: 0.12, filter: { type: 'lowpass', f: 300, f1: 1500 } });
        rumble(v, 1, 0.3, 400, 0.5);
      }),
    ],
  },
  'booma.growl': {
    group: 'Enemies', label: 'Booma family: wind-up growl', gap: 0.1, max: 3, x: 1,
    variants: [
      v_('Growl', 'Rough, breathy growl', (v, size) => growl(pitched(v, 1 / size), 85, 0.5, 0.25)),
      v_('Snort', 'Shorter snort and grunt', (v, size) => {
        const w = pitched(v, 1 / size);
        noise(w, { a: 0.05, d: 0.22, gain: 0.25, filter: { type: 'bandpass', f: 800, q: 1.5 } });
        fm(w, { f: 120, f1: 95, ratio: 0.5, index: 5, d: 0.3, gain: 0.14, filter: { type: 'lowpass', f: 900 }, at: 0.08 });
      }),
      v_('FM roar', 'Subharmonic FM roar', (v, size) => {
        const w = pitched(v, 1 / size);
        fm(w, { f: 90, f1: 70, ratio: 0.5, index: 5, a: 0.08, d: 0.5, gain: 0.2, filter: { type: 'bandpass', f: 600, q: 0.8 } });
        rumble(w, 0.4, 0.2, 600, 0.05);
      }),
    ],
  },
  'enemy.swipe': {
    group: 'Enemies', label: 'Enemy claw swipe', gap: 0.06, x: 1,
    variants: [
      v_('Heavy swish', 'Heavier than the player swing', (v, size) => swoosh(pitched(v, 1 / size), 400, 1300, 0.22, 0.32)),
      v_('Claw', 'Swish with a scrape', (v, size) => {
        const w = pitched(v, 1 / size);
        swoosh(w, 450, 1400, 0.2, 0.25);
        noise(w, { d: 0.08, gain: 0.08, at: 0.1, filter: { type: 'bandpass', f: 4000, q: 3 } });
      }),
    ],
  },
  'booma.die': {
    group: 'Enemies', label: 'Booma family: death', gap: 0.08, x: 1,
    variants: [
      v_('Groan + thud', 'Falling groan, then the body hits the ground', (v, size) => {
        const w = pitched(v, 1 / size);
        fm(w, { f: 180, f1: 60, ratio: 0.5, index: 4, d: 0.6, gain: 0.15, filter: { type: 'bandpass', f: 700, q: 0.8 } });
        thump(w, 90, 0.3, 0.45, 0.42);
        rumble(w, 0.25, 0.2, 800, 0.01, 0.42);
      }),
      v_('Squeal + thud', 'Higher squeal', (v, size) => {
        const w = pitched(v, 1 / size);
        tone(w, { type: 'sawtooth', f: 600, f1: 200, d: 0.35, gain: 0.06, vib: [16, 60], filter: { type: 'bandpass', f: 1400, q: 1.2 } });
        thump(w, 90, 0.3, 0.45, 0.4);
      }),
    ],
  },
  'lily.charge': {
    group: 'Enemies', label: 'Poison Lily: charging spit / burst', gap: 0.15,
    variants: [
      v_('Hiss', 'Rising hiss', (v) => noise(v, { a: 0.35, d: 0.3, gain: 0.15, filter: { type: 'bandpass', f: 2000, f1: 5000, fT: 0.5, q: 2 } })),
      v_('Gurgle', 'Bubbling build-up', (v) => {
        bubbles(v, 10, 0.6, 0.06, 300, 900);
        noise(v, { a: 0.4, d: 0.2, gain: 0.06, filter: { type: 'highpass', f: 3000 } });
      }),
    ],
  },
  'lily.spit': {
    group: 'Enemies', label: 'Poison Lily: spit', gap: 0.1,
    variants: [
      v_('Ptoo', 'Wet ptoo', (v) => {
        crack(v, 0.06, 0.3, 1200);
        tone(v, { f: 500, f1: 200, d: 0.12, gain: 0.2 });
      }),
      v_('Pop', 'Bubbly pop', (v) => {
        tone(v, { f: 300, f1: 900, d: 0.08, gain: 0.25 });
        noise(v, { d: 0.06, gain: 0.15, filter: { type: 'bandpass', f: 1500 } });
      }),
    ],
  },
  'lily.splat': {
    group: 'Enemies', label: 'Poison Lily: glob lands', gap: 0.05,
    variants: [
      v_('Splat', 'Wet splat with bubbles', (v) => {
        noise(v, { d: 0.25, gain: 0.35, filter: { type: 'lowpass', f: 1600, f1: 400 } });
        bubbles(v, 5, 0.3, 0.06, 400, 900);
      }),
      v_('Sizzle', 'Acidic sizzle', (v) => noise(v, { a: 0.01, d: 0.5, gain: 0.15, filter: { type: 'highpass', f: 3000, f1: 6000 } })),
    ],
  },
  'lily.burst': {
    group: 'Enemies', label: 'Lily: petal burst', gap: 0.1,
    variants: [
      v_('Puff', 'Outward puff with a pop', (v) => {
        noise(v, { d: 0.3, gain: 0.35, filter: { type: 'bandpass', f: 2000, f1: 600, q: 0.7 }, wet: 0.3 });
        thump(v, 160, 0.12, 0.3);
      }),
      v_('Whomp', 'Deeper burst', (v) => explosion(v, 0.5, 0.4)),
    ],
  },
  'lily.die': {
    group: 'Enemies', label: 'Lily: death', gap: 0.08,
    variants: [
      v_('Wilt', 'Wilting warble and a squish', (v) => {
        fm(v, { f: 420, f1: 110, ratio: 1.5, index: 2, d: 0.6, gain: 0.1, vib: [10, 50] });
        noise(v, { d: 0.18, gain: 0.2, at: 0.2, filter: { type: 'lowpass', f: 900 } });
      }),
      v_('Squish', 'Just the squish', (v) => noise(v, { d: 0.25, gain: 0.3, filter: { type: 'bandpass', f: 700, f1: 300, q: 1.2 } })),
    ],
  },
  'migium.charge': {
    group: 'Enemies', label: 'Migium: charging lightning', gap: 0.2,
    variants: [
      v_('Rising buzz', 'Electric charge building up', (v) => {
        fm(v, { type: 'sawtooth', f: 90, f1: 360, ratio: 2, index: 2, a: 0.8, d: 0.3, gain: 0.05, filter: { type: 'lowpass', f: 2000 } });
        noise(v, { a: 0.8, d: 0.2, gain: 0.05, filter: { type: 'highpass', f: 5000 } });
      }),
      v_('Crackling', 'Sparse crackles building up', (v) => {
        for (let i = 0; i < 9; i++) crack(v, 0.012, 0.06 + i * 0.015, 4000, i * 0.11);
      }),
    ],
  },
  'enemy.lightning': {
    group: 'Enemies', label: 'Migium: lightning strikes', gap: 0.05,
    variants: [
      v_('Thunder crack', 'Crack and rumble', (v) => {
        noise(v, { d: 0.05, gain: 0.5, filter: { type: 'highpass', f: 1500 } });
        rumble(v, 0.8, 0.4, 450, 0.04, 0.03);
      }),
      v_('Zap', 'Buzzy zap', (v) => fm(v, { f: 110, ratio: 7.3, index: 8, index1: 1, d: 0.3, gain: 0.18 })),
    ],
  },
  'panarms.split': {
    group: 'Enemies', label: 'Pan Arms splits / merges', gap: 0.3,
    variants: [
      v_('Clang', 'Metallic clang and whoosh', (v) => {
        fm(v, { f: 300, ratio: 1.41, index: 4, index1: 0.3, d: 0.6, gain: 0.15, wet: 0.4 });
        swoosh(v, 400, 1500, 0.3, 0.25);
      }),
      v_('Stretch', 'Rubbery stretch', (v) => tone(v, { type: 'sawtooth', f: 120, f1: 320, d: 0.4, gain: 0.08, filter: { type: 'lowpass', f: 900 }, vib: [9, 40] })),
    ],
  },
  'boss.step': {
    group: 'Enemies', label: 'Giant footstep (Dragon)', gap: 0.15, ref: 20, jitter: 0.08,
    variants: [
      v_('Thud', 'Heavy ground thud', (v) => {
        thump(v, 60, 0.35, 0.55);
        rumble(v, 0.3, 0.3, 300);
      }),
      v_('Thud + rubble', 'Thud with a little rubble', (v) => {
        thump(v, 60, 0.35, 0.5);
        for (let i = 0; i < 3; i++) noise(v, { d: 0.04, gain: 0.05, at: 0.05 + i * 0.06, filter: { type: 'bandpass', f: 1200, q: 2 } });
      }),
    ],
  },

  // ================================================================ Dragon
  'dragon.roar': {
    group: 'Dragon', label: 'Roar (intro, enraged)', gap: 0.8, ref: 30,
    variants: [
      v_('Roar', 'Layered growl, breath and sub', (v) => {
        growl(v, 130, 1.6, 0.4, 18);
        fm(v, { f: 70, f1: 55, ratio: 0.5, index: 6, a: 0.1, d: 1.5, gain: 0.2 });
      }),
      v_('Screech roar', 'Higher, screechier', (v) => {
        growl(v, 260, 1.3, 0.35, 22);
        rumble(v, 1.2, 0.35, 500, 0.1);
      }),
    ],
  },
  'dragon.growl': {
    group: 'Dragon', label: 'Growl (rears up for a stomp)', gap: 0.4, ref: 25,
    variants: [
      v_('Growl', 'Short low growl with a wing flap', (v) => {
        growl(v, 75, 0.7, 0.3, 16);
        swoosh(v, 200, 700, 0.5, 0.3, 0.15);
      }),
      v_('Huff', 'Breathy huff', (v) => rumble(v, 0.7, 0.45, 900, 0.15)),
    ],
  },
  'boss.slam': {
    group: 'Dragon', label: 'Stomp / slam / crash impact', gap: 0.15, ref: 30,
    variants: [
      v_('Slam', 'Deep boom, crack and rubble', (v) => slam(v)),
      v_('Distorted slam', 'Grittier boom', (v) => {
        const g = group(v, { drive: 0.7, filter: { type: 'lowpass', f: 2500 } });
        slam(g, 0.7);
      }),
    ],
  },
  'dragon.inhale': {
    group: 'Dragon', label: 'Inhale before fire breath', gap: 0.5, ref: 25,
    variants: [
      v_('Inhale', 'Reverse whoosh with a growl underneath', (v) => {
        noise(v, { color: 'pink', a: 0.8, d: 0.15, gain: 0.35, filter: { type: 'bandpass', f: 300, f1: 1600, fT: 0.9, q: 1 } });
        growl(v, 60, 0.9, 0.12, 12);
      }),
      v_('Rumble', 'Building rumble', (v) => rumble(v, 1, 0.5, 500, 0.7)),
    ],
  },
  'dragon.breath': {
    group: 'Dragon', label: 'Fire breath (length = breath)', gap: 0.5, ref: 30, x: 2, len: 6,
    variants: [
      v_('Roaring fire', 'Roaring flame with crackles', (v, dur) => {
        noise(v, { color: 'brown', a: 0.1, h: dur, d: 0.6, gain: 0.5, filter: { type: 'lowpass', f: 1800 } });
        noise(v, { a: 0.1, h: dur, d: 0.4, gain: 0.12, filter: { type: 'bandpass', f: 1200, q: 0.5 } });
        for (let i = 0; i < dur * 12; i++) crack(v, 0.015, 0.1, 2500 + Math.random() * 3000, Math.random() * dur);
      }),
      v_('Jet', 'Hissing gas jet', (v, dur) => {
        noise(v, { a: 0.08, h: dur, d: 0.4, gain: 0.25, filter: { type: 'bandpass', f: 2200, q: 0.7 } });
        rumble(v, dur + 0.4, 0.4, 700, 0.1);
      }),
    ],
  },
  'dragon.burrow': {
    group: 'Dragon', label: 'Burrows / tunnels', gap: 0.5, ref: 30, len: 4,
    variants: [
      v_('Dig', 'Rumbling dig with gravel', (v) => {
        noise(v, { color: 'brown', a: 0.3, h: 1, d: 0.8, gain: 0.55, filter: { type: 'lowpass', f: 400 } });
        for (let i = 0; i < 14; i++) noise(v, { d: 0.05, gain: 0.06, at: i * 0.12, filter: { type: 'bandpass', f: 800 + Math.random() * 800, q: 2 } });
      }),
      v_('Earthquake', 'Pure low quake', (v) => rumble(v, 2, 0.6, 250, 0.3)),
    ],
  },
  'dragon.erupt': {
    group: 'Dragon', label: 'Bursts out of the ground', gap: 0.5, ref: 30,
    variants: [
      v_('Burst', 'Explosion of earth and a roar', (v) => {
        slam(v, 0.8);
        growl(later(v, 0.1), 140, 0.9, 0.25, 18);
      }),
      v_('Burst only', 'Explosion of earth', (v) => explosion(v, 1.4, 0.75)),
    ],
  },
  'boss.weak': {
    group: 'Dragon', label: 'Weak point exposed', gap: 0.5, ref: 40,
    variants: [
      v_('Two bells', 'Bright two-bell signal', (v) => {
        fm(v, { f: 1568, ratio: 3.5, index: 1.2, index1: 0.05, d: 0.8, gain: 0.09, wet: 0.5 });
        fm(v, { f: 2093, ratio: 3.5, index: 1.2, index1: 0.05, d: 0.9, gain: 0.09, at: 0.12, wet: 0.5 });
      }),
      v_('Gong', 'Low gong', (v) => fm(v, { f: 196, ratio: 1.4, index: 3, index1: 0.2, d: 2, gain: 0.18, wet: 0.6 })),
    ],
  },
  'boss.die': {
    group: 'Dragon', label: 'Boss death', gap: 1, ref: 50, len: 5,
    variants: [
      v_('Death roar', 'Descending roar into a huge rumble', (v) => {
        const g = group(v, { drive: 0.6, filter: { type: 'bandpass', f: 600, q: 0.8 }, wet: 0.5 });
        tone(g, { type: 'sawtooth', f: 180, f1: 50, a: 0.1, d: 2.2, gain: 0.35, vib: [14, 60] });
        rumble(v, 3, 0.7, 700, 0.2);
        slam(later(v, 1.6), 0.8);
      }),
      v_('Implosion', 'Reverse swell into a boom', (v) => {
        noise(v, { color: 'pink', a: 1.2, d: 0.1, gain: 0.4, filter: { type: 'lowpass', f: 300, f1: 4000, fT: 1.2 } });
        explosion(later(v, 1.25), 2, 0.85);
      }),
    ],
  },

  // ============================================================= De Rol Le
  'drl.screech': {
    group: 'De Rol Le', label: 'Screech (intro, enraged, shatter)', gap: 0.8, ref: 40,
    variants: [
      v_('Metal screech', 'Grinding metallic screech', (v) => {
        fm(v, { f: 620, f1: 380, ratio: 1.33, index: 6, a: 0.08, d: 1.4, gain: 0.12, vib: [9, 80], wet: 0.5 });
        noise(v, { a: 0.1, d: 1, gain: 0.1, filter: { type: 'bandpass', f: 2500, q: 2 } });
        growl(v, 90, 1.2, 0.2, 14);
      }),
      v_('Whale moan', 'Deep, eerie moan', (v) => {
        tone(v, { type: 'sawtooth', f: 200, f1: 95, a: 0.3, d: 1.6, gain: 0.12, vib: [3, 60], filter: { type: 'bandpass', f: 600, q: 1.5 }, wet: 0.7 });
        rumble(v, 1.5, 0.3, 300, 0.3);
      }),
    ],
  },
  'drl.splash': {
    group: 'De Rol Le', label: 'Dives / surfaces (splash)', gap: 0.3, ref: 30,
    variants: [
      v_('Splash', 'Big splash with drips', (v) => {
        noise(v, { d: 0.7, gain: 0.45, filter: { type: 'lowpass', f: 4500, f1: 600 }, wet: 0.4 });
        noise(v, { color: 'brown', d: 0.4, gain: 0.3, filter: { type: 'lowpass', f: 600 } });
        for (let i = 0; i < 6; i++) tone(v, { f: 1200 + Math.random() * 900, f1: 2500, d: 0.04, gain: 0.04, at: 0.3 + Math.random() * 0.6 });
      }),
      v_('Surge', 'Rushing water surge', (v) => noise(v, { color: 'pink', a: 0.2, d: 0.9, gain: 0.4, filter: { type: 'bandpass', f: 500, f1: 2500, fT: 0.4, q: 0.7 } })),
    ],
  },
  'drl.bomb': {
    group: 'De Rol Le', label: 'Mine launched', gap: 0.06, max: 6, ref: 25,
    variants: [
      v_('Pomp', 'Hollow launch', (v) => {
        tone(v, { f: 320, f1: 130, d: 0.15, gain: 0.35 });
        noise(v, { d: 0.1, gain: 0.12, filter: { type: 'bandpass', f: 800 } });
      }),
      v_('Mortar', 'Mortar thunk with a whistle', (v) => {
        thump(v, 140, 0.15, 0.45);
        tone(v, { f: 1800, f1: 900, a: 0.05, d: 0.4, gain: 0.03, at: 0.05 });
      }),
    ],
  },
  'drl.explode': {
    group: 'De Rol Le', label: 'Mine explodes', gap: 0.06, max: 6, ref: 25,
    variants: [
      v_('Boom', 'Explosion', (v) => explosion(v, 1, 0.6)),
      v_('Water boom', 'Explosion with a splash', (v) => {
        explosion(v, 0.8, 0.5);
        noise(v, { d: 0.5, gain: 0.2, at: 0.05, filter: { type: 'lowpass', f: 3500, f1: 600 } });
      }),
    ],
  },
  'drl.charge': {
    group: 'De Rol Le', label: 'Beam charging', gap: 0.5, ref: 35,
    variants: [
      v_('Whine', 'Rising FM whine', (v) => {
        fm(v, { f: 150, f1: 900, ratio: 2.01, index: 2, a: 1, d: 0.3, gain: 0.1, wet: 0.4 });
        noise(v, { a: 1, d: 0.2, gain: 0.05, filter: { type: 'highpass', f: 4000 } });
      }),
      v_('Hum', 'Rising chord hum', (v) => {
        for (const r of [1, 1.5, 2]) tone(v, { type: 'sawtooth', f: 100 * r, f1: 300 * r, a: 1, d: 0.3, gain: 0.03, filter: { type: 'lowpass', f: 1500 } });
      }),
    ],
  },
  'drl.beam': {
    group: 'De Rol Le', label: 'Sweeping beam (length = beam)', gap: 0.5, ref: 40, x: 2, len: 6,
    variants: [
      v_('Laser', 'Wobbling laser with a hiss', (v, dur) => {
        const g = group(v, { filter: { type: 'bandpass', f: 1200, q: 0.8 }, wet: 0.4 });
        tone(g, { type: 'sawtooth', f: 220, a: 0.05, h: dur, d: 0.3, gain: 0.25, vib: [7, 40] });
        tone(g, { type: 'square', f: 331, a: 0.05, h: dur, d: 0.3, gain: 0.12, vib: [7.5, 40] });
        noise(v, { a: 0.05, h: dur, d: 0.3, gain: 0.06, filter: { type: 'highpass', f: 5000 } });
      }),
      v_('FM growl', 'Growling FM beam', (v, dur) => {
        fm(v, { f: 110, ratio: 3.01, index: 5, a: 0.05, h: dur, d: 0.3, gain: 0.12, vib: [6, 30] });
      }),
    ],
  },
  'drl.spray': {
    group: 'De Rol Le', label: 'Poison spray', gap: 0.5, ref: 35,
    variants: [
      v_('Hiss + bubbles', 'Spraying hiss with bubbles', (v) => {
        noise(v, { a: 0.1, h: 1, d: 0.6, gain: 0.2, filter: { type: 'bandpass', f: 2500, q: 0.8 } });
        bubbles(v, 12, 1.6, 0.05, 250, 700);
      }),
      v_('Splatter', 'Wet splatter', (v) => {
        for (let i = 0; i < 8; i++) noise(v, { d: 0.12, gain: 0.15, at: i * 0.18, filter: { type: 'lowpass', f: 1500, f1: 400 } });
      }),
    ],
  },
  'drl.plate': {
    group: 'De Rol Le', label: 'Shell plate breaks', gap: 0.2, ref: 30,
    variants: [
      v_('Crack', 'Bony crack', (v) => {
        crack(v, 0.1, 0.5, 1800);
        fm(v, { f: 500, ratio: 1.41, index: 3, index1: 0.2, d: 0.3, gain: 0.12 });
      }),
      v_('Clang', 'Armour clang', (v) => fm(v, { f: 260, ratio: 2.76, index: 4, index1: 0.3, d: 0.8, gain: 0.18, wet: 0.4 })),
    ],
  },
  'drl.shatter': {
    group: 'De Rol Le', label: 'Shell shatters', gap: 1, ref: 50,
    variants: [
      v_('Shatter', 'Glassy shatter and a boom', (v) => {
        for (let i = 0; i < 12; i++) fm(v, { f: 1800 + Math.random() * 3000, ratio: 2.7, index: 1.5, d: 0.3, gain: 0.04, at: Math.random() * 0.4, wet: 0.5 });
        noise(v, { d: 0.8, gain: 0.3, filter: { type: 'highpass', f: 3000 } });
        thump(v, 70, 0.6, 0.6);
      }),
      v_('Crumble', 'Heavy crumbling', (v) => {
        slam(v, 0.7);
        for (let i = 0; i < 6; i++) crack(v, 0.06, 0.25, 1200 + Math.random() * 1000, 0.1 + i * 0.12);
      }),
    ],
  },

  // ================================================================= Mines
  'gunbot.charge': {
    group: 'Mines', label: 'Gillchic aims (line shot charging)', gap: 0.15, ref: 14,
    variants: [
      v_('Servo whine', 'Rising servo whine', (v) => {
        tone(v, { type: 'square', f: 420, f1: 1250, a: 0.05, d: 0.75, gain: 0.04, filter: { type: 'lowpass', f: 2500 } });
        noise(v, { d: 0.12, gain: 0.06, filter: { type: 'bandpass', f: 1800, q: 3 } });
      }),
      v_('Lock-on beeps', 'Three quickening beeps', (v) => {
        for (const [t, f] of [[0, 1400], [0.32, 1600], [0.56, 1900]] as const) tone(v, { type: 'square', f, d: 0.07, gain: 0.04, at: t });
      }),
    ],
  },
  'gunbot.shot': {
    group: 'Mines', label: 'Gillchic fires', gap: 0.06, max: 5, ref: 16,
    variants: [
      v_('Blaster', 'Downward laser zap', (v) => {
        fm(v, { f: 1600, f1: 220, ratio: 0.51, index: 4, index1: 0.5, d: 0.22, gain: 0.16 });
        noise(v, { d: 0.08, gain: 0.12, filter: { type: 'highpass', f: 3000 } });
      }),
      v_('Pulse', 'Thick pulse round', (v) => {
        tone(v, { type: 'sawtooth', f: 520, f1: 110, d: 0.18, gain: 0.18, filter: { type: 'lowpass', f: 2200, f1: 400 } });
        thump(v, 160, 0.1, 0.25);
      }),
    ],
  },
  'gunbot.swipe': {
    group: 'Mines', label: 'Gillchic pincer swipe', gap: 0.1, ref: 10,
    variants: [
      v_('Servo snap', 'Servo and a snap', (v) => {
        tone(v, { type: 'square', f: 300, f1: 700, d: 0.18, gain: 0.04, filter: { type: 'lowpass', f: 1800 } });
        swoosh(v, 700, 2600, 0.22, 0.2, 0.15);
      }),
      v_('Clack', 'Metal clack', (v) => fm(v, { f: 900, ratio: 1.41, index: 3, index1: 0.1, d: 0.12, gain: 0.12 })),
    ],
  },
  'gunbot.offline': {
    group: 'Mines', label: 'Gillchic knocked offline', gap: 0.1, ref: 14,
    variants: [
      v_('Power down', 'Falling whine and a clunk', (v) => {
        tone(v, { type: 'sawtooth', f: 900, f1: 70, d: 0.7, gain: 0.08, filter: { type: 'lowpass', f: 2200, f1: 300 } });
        thump(v, 120, 0.2, 0.3, 0.35);
      }),
      v_('Short circuit', 'Crackling short', (v) => {
        for (let i = 0; i < 8; i++) crack(v, 0.012, 0.14, 2500 + Math.random() * 3000, Math.random() * 0.45);
        tone(v, { type: 'square', f: 180, f1: 60, d: 0.5, gain: 0.05 });
      }),
    ],
  },
  'gunbot.reboot': {
    group: 'Mines', label: 'Gillchic reboots', gap: 0.1, ref: 14,
    variants: [
      v_('Boot chirp', 'Rising power-up with a chirp', (v) => {
        tone(v, { type: 'sawtooth', f: 90, f1: 700, a: 0.3, d: 0.25, gain: 0.07, filter: { type: 'lowpass', f: 600, f1: 3000 } });
        tone(v, { type: 'square', f: 1800, d: 0.06, gain: 0.04, at: 0.5 });
        tone(v, { type: 'square', f: 2400, d: 0.06, gain: 0.04, at: 0.58 });
      }),
      v_('Spin up', 'Motor spinning up', (v) => fm(v, { f: 60, f1: 400, ratio: 2, index: 3, a: 0.5, d: 0.2, gain: 0.1 })),
    ],
  },
  'garanz.plant': {
    group: 'Mines', label: 'Garanz plants (hydraulics)', gap: 0.3, ref: 18,
    variants: [
      v_('Hydraulic', 'Hiss and heavy clunk', (v) => {
        noise(v, { a: 0.05, d: 0.5, gain: 0.18, filter: { type: 'bandpass', f: 3500, f1: 1500, q: 1.2 } });
        thump(v, 70, 0.35, 0.5, 0.3);
        crack(v, 0.04, 0.2, 1200, 0.3);
      }),
      v_('Gears', 'Ratcheting gears', (v) => {
        for (let i = 0; i < 7; i++) fm(v, { f: 300 + i * 30, ratio: 2.4, index: 2, d: 0.05, gain: 0.07, at: i * 0.07 });
        thump(v, 80, 0.3, 0.4, 0.5);
      }),
    ],
  },
  'garanz.launch': {
    group: 'Mines', label: 'Garanz missile launch', gap: 0.08, max: 6, ref: 22,
    variants: [
      v_('Whoosh', 'Rocket whoosh', (v) => {
        thump(v, 150, 0.12, 0.35);
        noise(v, { a: 0.02, d: 0.6, gain: 0.18, filter: { type: 'bandpass', f: 800, f1: 2500, q: 0.8 } });
      }),
      v_('Pop + whistle', 'Launcher pop and a whistle', (v) => {
        crack(v, 0.05, 0.3, 1500);
        tone(v, { f: 2200, f1: 1100, a: 0.05, d: 0.6, gain: 0.03, at: 0.05 });
      }),
    ],
  },
  'missile.explode': {
    group: 'Mines', label: 'Missile explodes', gap: 0.06, max: 6, ref: 24,
    variants: [
      v_('Boom', 'Explosion', (v) => explosion(v, 0.9, 0.6)),
      v_('Crack boom', 'Sharp blast', (v) => {
        explosion(v, 0.7, 0.5);
        crack(v, 0.06, 0.3, 3000);
      }),
    ],
  },
  'garanz.stomp': {
    group: 'Mines', label: 'Garanz stomp', gap: 0.3, ref: 20,
    variants: [
      v_('Stomp', 'Heavy metal stomp', (v) => slam(v, 0.6)),
      v_('Clang', 'Stomp with a clang', (v) => {
        thump(v, 80, 0.5, 0.6);
        fm(v, { f: 180, ratio: 2.76, index: 4, index1: 0.3, d: 0.7, gain: 0.12, wet: 0.4 });
      }),
    ],
  },
  'sinow.crouch': {
    group: 'Mines', label: 'Sinow crouches (leap coming)', gap: 0.2, ref: 16,
    variants: [
      v_('Charge', 'Quick rising charge', (v) => fm(v, { f: 300, f1: 1500, ratio: 2.01, index: 2, a: 0.4, d: 0.12, gain: 0.07 })),
      v_('Click', 'Two sharp clicks', (v) => {
        crack(v, 0.015, 0.2, 4000);
        crack(v, 0.015, 0.2, 5000, 0.12);
      }),
    ],
  },
  'sinow.leap': {
    group: 'Mines', label: 'Sinow leaps', gap: 0.2, ref: 16,
    variants: [
      v_('Jet', 'Jump jet burst', (v) => {
        swoosh(v, 400, 2200, 0.35, 0.3);
        thump(v, 140, 0.1, 0.25);
      }),
      v_('Whoosh', 'Clean whoosh', (v) => swoosh(v, 900, 3500, 0.3, 0.3)),
    ],
  },
  'sinow.slash': {
    group: 'Mines', label: 'Sinow slash', gap: 0.08, ref: 12,
    variants: [
      v_('Blade', 'Hot blade cut', (v) => {
        swoosh(v, 1500, 5000, 0.14, 0.25);
        tone(v, { type: 'sawtooth', f: 1400, f1: 900, d: 0.12, gain: 0.03, filter: { type: 'bandpass', f: 2000 } });
      }),
      v_('Shing', 'Metallic shing', (v) => fm(v, { f: 2600, ratio: 1.5, index: 2, index1: 0.2, d: 0.25, gain: 0.06 })),
    ],
  },
  'sinow.slashBig': {
    group: 'Mines', label: 'Sinow finisher (burns)', gap: 0.1, ref: 12,
    variants: [
      v_('Flame cut', 'Cut with a flare of fire', (v) => {
        swoosh(v, 1000, 4500, 0.2, 0.3);
        swoosh(v, 250, 1200, 0.4, 0.2, 0.05);
      }),
      v_('Heavy shing', 'Ringing heavy cut', (v) => {
        fm(v, { f: 1800, ratio: 1.5, index: 3, index1: 0.2, d: 0.45, gain: 0.08, wet: 0.4 });
        thump(v, 160, 0.1, 0.2);
      }),
    ],
  },
  'sinow.flip': {
    group: 'Mines', label: 'Sinow backflips away', gap: 0.2, ref: 14,
    variants: [
      v_('Flip', 'Spinning whoosh', (v) => {
        swoosh(v, 600, 1800, 0.25, 0.18);
        swoosh(v, 600, 1800, 0.2, 0.14, 0.2);
      }),
      v_('Land', 'Whoosh and a landing tap', (v) => {
        swoosh(v, 700, 2500, 0.35, 0.2);
        crack(v, 0.03, 0.2, 900, 0.42);
      }),
    ],
  },
  'machine.die': {
    group: 'Mines', label: 'Machine destroyed', gap: 0.1, ref: 18,
    variants: [
      v_('Sparks + boom', 'Small blast with sparks', (v) => {
        explosion(v, 0.6, 0.45);
        for (let i = 0; i < 10; i++) crack(v, 0.01, 0.1, 3000 + Math.random() * 4000, 0.1 + Math.random() * 0.6);
      }),
      v_('Wind down', 'Motor dying and a clatter', (v) => {
        tone(v, { type: 'sawtooth', f: 400, f1: 40, d: 0.8, gain: 0.08, filter: { type: 'lowpass', f: 1500 } });
        for (let i = 0; i < 5; i++) fm(v, { f: 500 + Math.random() * 600, ratio: 2.7, index: 2, d: 0.08, gain: 0.06, at: 0.3 + i * 0.09 });
      }),
    ],
  },
  'node.die': {
    group: 'Mines', label: 'Control node destroyed', gap: 0.5, ref: 30,
    variants: [
      v_('Shutdown', 'Big power-down with a burst', (v) => {
        explosion(v, 1, 0.5);
        tone(v, { type: 'sawtooth', f: 1200, f1: 50, d: 1.4, gain: 0.08, filter: { type: 'lowpass', f: 3000, f1: 300 }, wet: 0.5 });
      }),
      v_('Glass shatter', 'Core shatters', (v) => {
        for (let i = 0; i < 10; i++) fm(v, { f: 1800 + Math.random() * 2500, ratio: 2.7, index: 1.5, d: 0.3, gain: 0.04, at: Math.random() * 0.3, wet: 0.5 });
        thump(v, 70, 0.5, 0.45);
      }),
    ],
  },
  'volatile.warn': {
    group: 'Mines', label: 'Volatile elite about to blow', gap: 0.2, ref: 18,
    variants: [
      v_('Alarm', 'Rapid alarm beeps', (v) => {
        for (let i = 0; i < 8; i++) tone(v, { type: 'square', f: 1500, d: 0.05, gain: 0.05, at: i * (0.17 - i * 0.012) });
      }),
      v_('Overheat', 'Rising overheat hiss', (v) => {
        noise(v, { a: 1.1, d: 0.1, gain: 0.15, filter: { type: 'bandpass', f: 1500, f1: 5000, fT: 1.2, q: 1.5 } });
        tone(v, { f: 300, f1: 1200, a: 1.1, d: 0.1, gain: 0.05 });
      }),
    ],
  },
  'crusher.warn': {
    group: 'Mines', label: 'Crusher about to slam', gap: 0.3, ref: 14,
    variants: [
      v_('Klaxon', 'Two-tone warning', (v) => {
        tone(v, { type: 'square', f: 620, d: 0.25, gain: 0.04, filter: { type: 'lowpass', f: 2000 } });
        tone(v, { type: 'square', f: 480, d: 0.25, gain: 0.04, at: 0.3, filter: { type: 'lowpass', f: 2000 } });
        tone(v, { type: 'square', f: 620, d: 0.25, gain: 0.04, at: 0.6, filter: { type: 'lowpass', f: 2000 } });
      }),
      v_('Pressure', 'Building hydraulic hiss', (v) => noise(v, { a: 1.1, d: 0.15, gain: 0.12, filter: { type: 'bandpass', f: 2500, q: 1.5 } })),
    ],
  },
  'crusher.slam': {
    group: 'Mines', label: 'Crusher slams', gap: 0.2, ref: 18,
    variants: [
      v_('Slam', 'Heavy metal slam', (v) => {
        slam(v, 0.7);
        fm(v, { f: 110, ratio: 2.76, index: 3, index1: 0.2, d: 0.6, gain: 0.1 });
      }),
      v_('Thud', 'Deep thud', (v) => {
        thump(v, 60, 0.6, 0.7);
        crack(v, 0.05, 0.3, 1500);
      }),
    ],
  },
  'laser.on': {
    group: 'Mines', label: 'Laser fence powers on', gap: 0.2, ref: 14,
    variants: [
      v_('Hum on', 'Buzzing hum switching on', (v) => {
        const g = group(v, { filter: { type: 'bandpass', f: 1200, q: 1.2 } });
        tone(g, { type: 'sawtooth', f: 120, f1: 240, a: 0.02, h: 0.3, d: 0.3, gain: 0.12 });
        noise(v, { d: 0.15, gain: 0.05, filter: { type: 'highpass', f: 5000 } });
      }),
      v_('Zap', 'Quick zap', (v) => fm(v, { f: 220, ratio: 7.1, index: 5, index1: 0.5, d: 0.3, gain: 0.08 })),
    ],
  },

  // ================================================================ Warden
  'warden.boot': {
    group: 'Warden', label: 'Boots up (intro, enraged)', gap: 0.8, ref: 45,
    variants: [
      v_('Power surge', 'Deep surge with a klaxon', (v) => {
        tone(v, { type: 'sawtooth', f: 40, f1: 160, a: 0.8, d: 0.6, gain: 0.16, filter: { type: 'lowpass', f: 300, f1: 1800 } });
        tone(v, { type: 'square', f: 440, d: 0.35, gain: 0.04, at: 0.9, filter: { type: 'lowpass', f: 1500 } });
        tone(v, { type: 'square', f: 330, d: 0.35, gain: 0.04, at: 1.3, filter: { type: 'lowpass', f: 1500 } });
        rumble(v, 1.6, 0.3, 400, 0.3);
      }),
      v_('Engine roar', 'Engine revving up', (v) => {
        growl(v, 55, 1.6, 0.25, 8);
        fm(v, { f: 80, f1: 220, ratio: 2, index: 4, a: 0.9, d: 0.6, gain: 0.08 });
      }),
    ],
  },
  'warden.charge': {
    group: 'Warden', label: 'Winding up (slam, lockdown)', gap: 0.4, ref: 40,
    variants: [
      v_('Turbine', 'Turbine spinning up', (v) => {
        fm(v, { f: 120, f1: 700, ratio: 2.01, index: 2.5, a: 1.1, d: 0.3, gain: 0.1, wet: 0.3 });
        noise(v, { a: 1.1, d: 0.2, gain: 0.06, filter: { type: 'bandpass', f: 800, f1: 3000, fT: 1.2, q: 1 } });
      }),
      v_('Pistons', 'Pistons cycling faster', (v) => {
        for (let i = 0; i < 8; i++) thump(v, 110 + i * 8, 0.08, 0.2, i * (0.17 - i * 0.012));
      }),
    ],
  },
  'warden.grid': {
    group: 'Warden', label: 'Laser wall powers up', gap: 0.5, ref: 50,
    variants: [
      v_('Grid hum', 'Rising wall of hum', (v) => {
        const g = group(v, { filter: { type: 'bandpass', f: 900, q: 0.9 }, wet: 0.4 });
        for (const r of [1, 1.5, 2]) tone(g, { type: 'sawtooth', f: 90 * r, f1: 130 * r, a: 1.2, h: 3.5, d: 0.6, gain: 0.05 });
      }),
      v_('Zap rise', 'Electric crackle rising', (v) => {
        for (let i = 0; i < 18; i++) crack(v, 0.01, 0.06 + i * 0.006, 2000 + i * 200, i * 0.08);
        tone(v, { type: 'square', f: 200, f1: 600, a: 1.4, d: 0.2, gain: 0.03 });
      }),
    ],
    len: 6,
  },
  'warden.ignite': {
    group: 'Warden', label: 'Lockdown zone ignites (length = burst)', gap: 0.5, ref: 40, x: 1.7, len: 4,
    variants: [
      v_('Flamethrower', 'Roaring jet of flame', (v, dur) => {
        noise(v, { color: 'pink', a: 0.08, h: dur, d: 0.4, gain: 0.35, filter: { type: 'bandpass', f: 700, q: 0.6 } });
        rumble(v, dur + 0.4, 0.3, 300, 0.1);
      }),
      v_('Furnace', 'Deep furnace whoosh', (v, dur) => {
        noise(v, { color: 'brown', a: 0.1, h: dur, d: 0.4, gain: 0.5, filter: { type: 'lowpass', f: 1200 } });
        for (let i = 0; i < 12; i++) crack(v, 0.012, 0.08, 2500 + Math.random() * 3000, Math.random() * dur);
      }),
    ],
  },
  'warden.vent': {
    group: 'Warden', label: 'Core vents (weak point open)', gap: 0.5, ref: 50,
    variants: [
      v_('Discharge', 'Huge electric discharge', (v) => {
        fm(v, { f: 80, ratio: 7.3, index: 8, index1: 1, d: 1.2, gain: 0.2, wet: 0.5 });
        for (let i = 0; i < 14; i++) crack(v, 0.015, 0.15, 2500 + Math.random() * 4000, Math.random() * 1.0);
        tone(v, { type: 'sawtooth', f: 600, f1: 60, d: 1.6, gain: 0.07, filter: { type: 'lowpass', f: 2000, f1: 200 } });
      }),
      v_('Breaker trip', 'Breaker trips, power whines down', (v) => {
        thump(v, 90, 0.3, 0.6);
        crack(v, 0.06, 0.4, 2000);
        tone(v, { type: 'sawtooth', f: 900, f1: 50, d: 1.4, gain: 0.08, filter: { type: 'lowpass', f: 2500 } });
      }),
    ],
  },
  'warden.purge': {
    group: 'Warden', label: 'Lockdown zones reset', gap: 0.3, ref: 40,
    variants: [
      v_('Burst', 'Electric burst', (v) => {
        explosion(v, 1, 0.5);
        fm(v, { f: 150, ratio: 7.1, index: 6, index1: 0.5, d: 0.6, gain: 0.12 });
      }),
      v_('Shatter', 'Coil shatters', (v) => {
        for (let i = 0; i < 10; i++) fm(v, { f: 1500 + Math.random() * 3000, ratio: 2.7, index: 1.5, d: 0.25, gain: 0.05, at: Math.random() * 0.3 });
        thump(v, 80, 0.4, 0.4);
      }),
    ],
  },
  'warden.reroute': {
    group: 'Warden', label: 'Overclocks (phase 2)', gap: 1, ref: 60,
    variants: [
      v_('Reroute', 'Power slams back on, alarm', (v) => {
        slam(v, 0.7);
        tone(v, { type: 'sawtooth', f: 60, f1: 240, a: 0.6, d: 0.8, gain: 0.12, filter: { type: 'lowpass', f: 400, f1: 2500 } });
        for (let i = 0; i < 4; i++) tone(v, { type: 'square', f: i % 2 ? 520 : 690, d: 0.25, gain: 0.04, at: 0.8 + i * 0.3, filter: { type: 'lowpass', f: 2000 } });
      }),
      v_('Surge', 'Big electric surge', (v) => {
        fm(v, { f: 50, f1: 300, ratio: 3.01, index: 6, a: 0.8, d: 0.8, gain: 0.14, wet: 0.5 });
        rumble(v, 1.8, 0.4, 500, 0.4);
      }),
    ],
  },
  'warden.zap': {
    group: 'Warden', label: 'Floor cells discharge', gap: 0.2, ref: 40,
    variants: [
      v_('Zap', 'Floor-wide zap', (v) => {
        fm(v, { f: 110, ratio: 7.3, index: 7, index1: 0.5, d: 0.45, gain: 0.16 });
        noise(v, { d: 0.3, gain: 0.12, filter: { type: 'highpass', f: 3000 } });
      }),
      v_('Crackle', 'Crackling sheet', (v) => {
        for (let i = 0; i < 12; i++) crack(v, 0.012, 0.13, 2000 + Math.random() * 4000, Math.random() * 0.35);
      }),
    ],
  },

  // ================================================================= World
  'gate.close': {
    group: 'World', label: 'Laser gates seal', gap: 0.5, ref: 40,
    variants: [
      v_('Zzzt up', 'Electric fence powering on', (v) => {
        const g = group(v, { filter: { type: 'bandpass', f: 900, q: 1 } });
        tone(g, { type: 'sawtooth', f: 80, f1: 160, a: 0.02, d: 0.6, gain: 0.2 });
        tone(g, { type: 'square', f: 160, f1: 320, a: 0.02, d: 0.6, gain: 0.1 });
        noise(v, { d: 0.3, gain: 0.08, filter: { type: 'highpass', f: 4000 } });
      }),
      v_('Clamp', 'Heavy clamp and hum', (v) => {
        thump(v, 110, 0.2, 0.45);
        tone(v, { type: 'sawtooth', f: 120, a: 0.05, d: 0.8, gain: 0.05, filter: { type: 'lowpass', f: 700 } });
      }),
    ],
  },
  'gate.open': {
    group: 'World', label: 'Laser gates open (room cleared)', gap: 0.5, ref: 40,
    variants: [
      v_('Power down', 'Descending zap and a chime', (v) => {
        const g = group(v, { filter: { type: 'bandpass', f: 900, q: 1 } });
        tone(g, { type: 'sawtooth', f: 320, f1: 80, d: 0.5, gain: 0.15 });
        sparkle(v, [1047, 1568], 0.1, 0.07, 0.6, 2);
      }),
      v_('Release', 'Air release', (v) => noise(v, { a: 0.02, d: 0.6, gain: 0.2, filter: { type: 'bandpass', f: 3000, f1: 800, q: 0.7 } })),
    ],
  },
  'world.switch': {
    group: 'World', label: 'Switch pressed', gap: 0.3,
    variants: [
      v_('Click + beep', 'Click and two beeps', (v) => {
        crack(v, 0.02, 0.2, 2500);
        tone(v, { type: 'square', f: 1200, d: 0.05, gain: 0.05, at: 0.05 });
        tone(v, { type: 'square', f: 1600, d: 0.08, gain: 0.05, at: 0.12 });
      }),
      v_('Clunk', 'Mechanical clunk', (v) => {
        thump(v, 200, 0.12, 0.4);
        fm(v, { f: 220, ratio: 1.41, index: 2, d: 0.2, gain: 0.08 });
      }),
    ],
  },
  'world.teleport': {
    group: 'World', label: 'Teleport / Telepipe', gap: 0.5,
    variants: [
      v_('Warp', 'Rising warp with shimmer', (v) => {
        fm(v, { f: 200, f1: 1800, ratio: 0.5, index: 3, a: 0.6, d: 0.4, gain: 0.12, wet: 0.6 });
        noise(v, { a: 0.6, d: 0.3, gain: 0.06, filter: { type: 'highpass', f: 1000, f1: 8000, fT: 0.8 } });
        sparkle(v, [1568, 2093, 2637], 0.08, 0.04, 0.6, 2);
      }),
      v_('Beam out', 'Descending beam', (v) => {
        fm(v, { f: 1600, f1: 150, ratio: 2, index: 2, d: 0.9, gain: 0.1, wet: 0.6 });
        noise(v, { d: 0.6, gain: 0.05, filter: { type: 'highpass', f: 6000 } });
      }),
    ],
  },
  'lava.warn': {
    group: 'World', label: 'Lava vent bubbling (warning)', gap: 0.5, ref: 12,
    variants: [
      v_('Bubble', 'Thick bubbling', (v) => {
        rumble(v, 1, 0.3, 300, 0.3);
        bubbles(v, 8, 0.9, 0.06, 120, 300);
      }),
      v_('Hiss', 'Steam hiss', (v) => noise(v, { a: 0.4, d: 0.5, gain: 0.12, filter: { type: 'bandpass', f: 4000, q: 1 } })),
    ],
  },
  'lava.erupt': {
    group: 'World', label: 'Lava vent erupts', gap: 0.2, ref: 14,
    variants: [
      v_('Eruption', 'Roaring burst with crackles', (v) => {
        rumble(v, 1, 0.6, 2000, 0.02);
        thump(v, 60, 0.4, 0.4);
        for (let i = 0; i < 10; i++) crack(v, 0.015, 0.1, 3000 + Math.random() * 3000, Math.random() * 0.8);
      }),
      v_('Whoosh', 'Fiery whoosh', (v) => swoosh(v, 300, 1500, 0.8, 0.45)),
    ],
  },

  // ================================================================== Loot
  'pickup.meseta': {
    group: 'Loot', label: 'Pick up Meseta', gap: 0.06,
    variants: [
      v_('Ching', 'Two coin chings', (v) => {
        fm(v, { f: 2093, ratio: 1.5, index: 1, index1: 0.1, d: 0.2, gain: 0.07 });
        fm(v, { f: 2637, ratio: 1.5, index: 1, index1: 0.1, d: 0.35, gain: 0.07, at: 0.06, wet: 0.3 });
      }),
      v_('Blip blip', 'Retro two-blip', (v) => {
        tone(v, { type: 'square', f: 988, d: 0.05, gain: 0.05 });
        tone(v, { type: 'square', f: 1319, d: 0.12, gain: 0.05, at: 0.06 });
      }),
    ],
  },
  'pickup.item': {
    group: 'Loot', label: 'Pick up an item', gap: 0.06,
    variants: [
      v_('Pop chime', 'Soft pop and a chime', (v) => {
        tone(v, { f: 600, f1: 900, d: 0.08, gain: 0.15 });
        fm(v, { f: 1568, ratio: 2, index: 0.8, d: 0.3, gain: 0.07, at: 0.05, wet: 0.3 });
      }),
      v_('Up blip', 'Rising blip', (v) => tone(v, { type: 'triangle', f: 700, f1: 1400, d: 0.15, gain: 0.15 })),
    ],
  },
  'loot.rare': {
    group: 'Loot', label: 'Rare item drops', gap: 0.5, ref: 30, len: 4,
    variants: [
      v_('Sparkle chime', 'Bell arpeggio with a shimmering tail', (v) => {
        sparkle(v, [1319, 1976, 2637, 3322], 0.09, 0.08, 1.4, 3.5);
        noise(v, { a: 0.3, d: 1.2, gain: 0.03, filter: { type: 'highpass', f: 7000 }, wet: 0.6 });
      }),
      v_('Twin ding', 'Two loud bells, then the pair again', (v) => {
        for (const at of [0, 0.4]) {
          fm(v, { f: 1568, ratio: 3.5, index: 1.4, index1: 0.05, d: 1.2, gain: 0.1, at, wet: 0.6 });
          fm(v, { f: 2349, ratio: 3.5, index: 1.4, index1: 0.05, d: 1.2, gain: 0.07, at: at + 0.02, wet: 0.6 });
        }
      }),
      v_('Twinkle run', 'Quick pentatonic run up to a bell', (v) => {
        [1047, 1175, 1319, 1568, 1760, 2093].forEach((f, i) => tone(v, { type: 'triangle', f, d: 0.12, gain: 0.06, at: i * 0.04 }));
        fm(v, { f: 2093, ratio: 3.5, index: 1.4, index1: 0.05, d: 1.4, gain: 0.1, at: 0.26, wet: 0.6 });
      }),
    ],
  },
  'mag.feed': {
    group: 'Loot', label: 'Mag learns a square', gap: 0.3,
    variants: [
      v_('Munch', 'Quick munches and a happy chirp', (v) => {
        for (let i = 0; i < 3; i++) tone(v, { f: 500 + i * 60, f1: 300, d: 0.05, gain: 0.15, at: i * 0.09 });
        tone(v, { f: 900, f1: 1500, d: 0.15, gain: 0.08, at: 0.32 });
      }),
      v_('Chirp', 'Two chirps', (v) => {
        tone(v, { f: 1100, f1: 1600, d: 0.08, gain: 0.08 });
        tone(v, { f: 1300, f1: 1900, d: 0.1, gain: 0.08, at: 0.1 });
      }),
    ],
  },
  'mag.hungry': {
    group: 'Loot', label: 'Mag point ready', gap: 1,
    variants: [
      v_('Boop beep', 'Friendly two-note chirp', (v) => {
        tone(v, { f: 880, d: 0.08, gain: 0.08 });
        tone(v, { f: 1320, d: 0.12, gain: 0.08, at: 0.1 });
      }),
      v_('Warble', 'Little warble', (v) => tone(v, { f: 1000, d: 0.3, gain: 0.07, vib: [12, 150] })),
    ],
  },

  // ==================================================================== UI
  'ui.open': {
    group: 'UI', label: 'Menu opens', gap: 0.1,
    variants: [
      v_('Swoosh up', 'Rising FM swoosh', (v) => fm(v, { f: 660, f1: 990, ratio: 2, index: 0.8, d: 0.12, gain: 0.08 })),
      v_('Two blips', 'Two rising blips', (v) => {
        tone(v, { type: 'triangle', f: 880, d: 0.05, gain: 0.08 });
        tone(v, { type: 'triangle', f: 1320, d: 0.08, gain: 0.08, at: 0.05 });
      }),
    ],
  },
  'ui.close': {
    group: 'UI', label: 'Menu closes', gap: 0.1,
    variants: [
      v_('Swoosh down', 'Falling FM swoosh', (v) => fm(v, { f: 990, f1: 660, ratio: 2, index: 0.8, d: 0.12, gain: 0.08 })),
      v_('Two blips', 'Two falling blips', (v) => {
        tone(v, { type: 'triangle', f: 1320, d: 0.05, gain: 0.08 });
        tone(v, { type: 'triangle', f: 880, d: 0.08, gain: 0.08, at: 0.05 });
      }),
    ],
  },
  'ui.cursor': {
    group: 'UI', label: 'Cursor / hover', gap: 0.04, jitter: 0,
    variants: [
      v_('Tick', 'Tiny square tick', (v) => tone(v, { type: 'square', f: 1800, d: 0.025, gain: 0.03, filter: { type: 'lowpass', f: 4000 } })),
      v_('Blip', 'Soft sine blip', (v) => tone(v, { f: 1320, d: 0.04, gain: 0.06 })),
    ],
  },
  'ui.confirm': {
    group: 'UI', label: 'Confirm', gap: 0.05, jitter: 0,
    variants: [
      v_('Two-tone', 'Rising two-tone', (v) => {
        tone(v, { type: 'triangle', f: 1047, d: 0.07, gain: 0.1 });
        tone(v, { type: 'triangle', f: 1568, d: 0.12, gain: 0.1, at: 0.05 });
      }),
      v_('Ping', 'FM ping', (v) => fm(v, { f: 1319, ratio: 2, index: 1, d: 0.2, gain: 0.08 })),
    ],
  },
  'ui.cancel': {
    group: 'UI', label: 'Cancel / back', gap: 0.05, jitter: 0,
    variants: [
      v_('Two-tone down', 'Falling two-tone', (v) => {
        tone(v, { type: 'triangle', f: 784, d: 0.07, gain: 0.1 });
        tone(v, { type: 'triangle', f: 523, d: 0.12, gain: 0.1, at: 0.05 });
      }),
      v_('Thup', 'Soft thup', (v) => tone(v, { f: 500, f1: 300, d: 0.08, gain: 0.15 })),
    ],
  },
  'ui.error': {
    group: 'UI', label: 'Not allowed / error', gap: 0.15, jitter: 0,
    variants: [
      v_('Buzz buzz', 'Double low buzz', (v) => {
        for (const at of [0, 0.12]) tone(v, { type: 'square', f: 150, d: 0.08, gain: 0.07, at, filter: { type: 'lowpass', f: 900 } });
      }),
      v_('Low beep', 'Single low beep', (v) => tone(v, { type: 'triangle', f: 220, d: 0.2, gain: 0.15 })),
    ],
  },
  'ui.buy': {
    group: 'UI', label: 'Buy', gap: 0.08, jitter: 0,
    variants: [
      v_('Ka-ching', 'Register ka-ching', (v) => {
        crack(v, 0.03, 0.15, 3000);
        fm(v, { f: 2093, ratio: 1.5, index: 1, d: 0.15, gain: 0.07, at: 0.04 });
        fm(v, { f: 2637, ratio: 1.5, index: 1, d: 0.4, gain: 0.08, at: 0.1, wet: 0.3 });
      }),
      v_('Coins', 'Coin cascade', (v) => {
        for (let i = 0; i < 4; i++) fm(v, { f: 1800 + Math.random() * 1200, ratio: 1.5, index: 1, d: 0.15, gain: 0.05, at: i * 0.05 });
      }),
    ],
  },
  'ui.sell': {
    group: 'UI', label: 'Sell', gap: 0.08, jitter: 0,
    variants: [
      v_('Coin drop', 'Coins into a tray', (v) => {
        for (let i = 0; i < 3; i++) fm(v, { f: 2400 - i * 300, ratio: 1.5, index: 1, d: 0.2, gain: 0.06, at: i * 0.07 });
      }),
      v_('Ching', 'Single ching', (v) => fm(v, { f: 2349, ratio: 1.5, index: 1, d: 0.35, gain: 0.08, wet: 0.3 })),
    ],
  },
  'ui.equip': {
    group: 'UI', label: 'Equip', gap: 0.08, jitter: 0,
    variants: [
      v_('Clank', 'Metallic clank', (v) => {
        fm(v, { f: 500, ratio: 1.41, index: 2, index1: 0.2, d: 0.2, gain: 0.1 });
        swoosh(v, 800, 2000, 0.1, 0.1);
      }),
      v_('Power on', 'Rising power-on', (v) => tone(v, { type: 'sawtooth', f: 200, f1: 600, d: 0.18, gain: 0.05, filter: { type: 'lowpass', f: 2500 } })),
    ],
  },

  // =============================================================== Jingles
  'jingle.levelup': {
    group: 'Jingles', label: 'Level up', gap: 1, duck: 1.8, len: 4, jitter: 0,
    variants: [
      v_('Brass fanfare', 'Quick brass triplet into a held chord', (v) => {
        score(v, 'brass', [[0, 'C5', 0.08], [0.09, 'E5', 0.08], [0.18, 'G5', 0.08], [0.27, 'C6', 0.9, 0.9], [0.27, 'G5', 0.9, 0.7], [0.27, 'E5', 0.9, 0.7]]);
        score(v, 'bell', [[0.27, 'C7', 0.5, 0.6], [0.4, 'G6', 0.5, 0.5]]);
        score(v, 'timpani', [[0.27, 'C3', 0.5, 0.7]]);
      }),
      v_('Chime cascade', 'Bells climbing two octaves to a chord', (v) => {
        ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => score(v, 'bell', [[i * 0.06, n, 0.3, 0.7]]));
        score(v, 'pad', [[0.36, 'C5', 1, 0.8], [0.36, 'E5', 1, 0.8], [0.36, 'G5', 1, 0.8]]);
      }),
    ],
  },
  'jingle.clear': {
    group: 'Jingles', label: 'Room cleared', gap: 1, duck: 1, len: 3, jitter: 0,
    variants: [
      v_('Three bells', 'Short resolving three-note bell', (v) => score(v, 'bell', [[0, 'G5', 0.3, 0.6], [0.12, 'C6', 0.3, 0.6], [0.24, 'E6', 0.8, 0.7]])),
      v_('Vibes', 'Soft vibraphone resolve', (v) => score(v, 'vibes', [[0, 'D5', 0.2], [0.12, 'G5', 0.2], [0.24, 'B5', 0.8]])),
      v_('None', 'No jingle: the gates and music are enough', () => {}),
    ],
  },
  'jingle.victory': {
    group: 'Jingles', label: 'Boss defeated', gap: 2, duck: 5, len: 7, jitter: 0,
    variants: [
      v_('Fanfare', 'Brass fanfare over timpani', (v) => {
        score(v, 'brass', [
          [0, 'G4', 0.15], [0.16, 'C5', 0.15], [0.32, 'E5', 0.15], [0.48, 'G5', 0.7, 0.9],
          [1.2, 'E5', 0.2], [1.44, 'F5', 0.3], [1.8, 'G5', 0.3], [2.16, 'C6', 1.8, 1], [2.16, 'G5', 1.8, 0.7], [2.16, 'E5', 1.8, 0.7],
        ]);
        score(v, 'timpani', [[0, 'C3', 0.4], [0.48, 'G2', 0.4], [1.8, 'G2', 0.3], [2.16, 'C3', 1, 0.9]]);
        score(v, 'strings', [[0.48, 'C4', 1.6, 0.6], [0.48, 'G4', 1.6, 0.6], [2.16, 'C4', 1.8, 0.7], [2.16, 'G4', 1.8, 0.7]]);
        score(v, 'crash', [[2.16, 'C4', 1, 0.8]]);
      }),
      v_('Heroic', 'Slower, broader theme with choir', (v) => {
        score(v, 'brass', [[0, 'D5', 0.5], [0.5, 'A4', 0.25], [0.75, 'D5', 0.25], [1, 'F#5', 0.5], [1.5, 'E5', 0.5], [2, 'A5', 1.8, 1]]);
        score(v, 'choir', [[0, 'D4', 1.9, 0.7], [0, 'F#4', 1.9, 0.7], [2, 'A3', 1.8, 0.8], [2, 'E4', 1.8, 0.8], [2, 'C#5', 1.8, 0.7]]);
        score(v, 'timpani', [[0, 'D3', 0.5], [2, 'A2', 1, 0.9]]);
      }),
    ],
  },
  'jingle.death': {
    group: 'Jingles', label: 'You have fallen', gap: 2, duck: 4, len: 6, jitter: 0,
    variants: [
      v_('Lament', 'Slow falling minor line over strings', (v) => {
        score(v, 'flute', [[0, 'E5', 0.5], [0.55, 'C5', 0.5], [1.1, 'A4', 0.5], [1.65, 'F4', 1.6, 0.7]]);
        score(v, 'strings', [[0, 'A3', 1.6, 0.6], [0, 'C4', 1.6, 0.6], [1.65, 'F3', 1.8, 0.6], [1.65, 'Ab3', 1.8, 0.6]]);
      }),
      v_('Toll', 'Low bell toll over a drone', (v) => {
        score(v, 'bell', [[0, 'A3', 1.5, 0.9], [1.4, 'E3', 2, 0.8]]);
        score(v, 'darkpad', [[0, 'A2', 3, 0.8]]);
      }),
    ],
  },
  'jingle.magEvolve': {
    group: 'Jingles', label: 'Mag evolves', gap: 2, duck: 2.5, len: 5, jitter: 0,
    variants: [
      v_('Transformation', 'Whole-tone shimmer resolving to a major chord', (v) => {
        ['C5', 'D5', 'E5', 'F#5', 'G#5', 'A#5', 'C6'].forEach((n, i) => score(v, 'harp', [[i * 0.07, n, 0.3, 0.7]]));
        score(v, 'bell', [[0.55, 'D6', 1.2], [0.55, 'F#6', 1.2, 0.6], [0.55, 'A6', 1.2, 0.6]]);
        score(v, 'pad', [[0.55, 'D5', 1.5], [0.55, 'F#5', 1.5], [0.55, 'A5', 1.5]]);
      }),
      v_('Sparkle up', 'Glittering climb', (v) => sparkle(v, [784, 988, 1175, 1568, 1976, 2349, 3136], 0.07, 0.07, 1.2, 3.5)),
    ],
  },
} satisfies Record<string, SfxDef>;

export type SfxId = keyof typeof DEFS;
export const SFX: Record<SfxId, SfxDef> = DEFS;

export const SFX_GROUPS: SfxGroup[] = ['Combat', 'Techniques', 'Player', 'Enemies', 'Dragon', 'De Rol Le', 'Mines', 'Warden', 'World', 'Loot', 'UI', 'Jingles'];
