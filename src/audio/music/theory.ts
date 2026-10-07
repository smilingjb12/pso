import type { InstId } from './instruments';

// Composition helpers: notes, chords and pattern strings turned into note
// events on a 16th-note grid. Tracks are written with these (see tracks.ts).

/** One note: start step (16ths from the loop start), MIDI note, length in steps, velocity. */
export interface NoteEv {
  s: number;
  n: number;
  l: number;
  v: number;
}

export type Layer = 'base' | 'calm' | 'battle';

export interface Part {
  inst: InstId;
  layer: Layer;
  notes: NoteEv[];
  gain?: number;
  pan?: number;
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' = 60, 'F#3', 'Bb2'. */
export function note(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

function pitchClass(s: string): number {
  return (PC[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12;
}

const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  '9': [0, 4, 7, 10, 14],
  '13': [0, 4, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  dim: [0, 3, 6],
  m7b5: [0, 3, 6, 10],
};

export interface Chord {
  root: number;
  bass: number;
  iv: number[];
}

/** 'Fmaj9', 'Em7', 'D/F#', 'A7sus4'. */
export function chord(sym: string): Chord {
  const [main, slash] = sym.split('/');
  const rootLen = main[1] === '#' || main[1] === 'b' ? 2 : 1;
  const root = pitchClass(main.slice(0, rootLen));
  const iv = QUALITY[main.slice(rootLen)];
  if (!iv) throw new Error(`bad chord ${sym}`);
  return { root, bass: slash ? pitchClass(slash) : root, iv };
}

/** Lift a pitch class into [low, low + 12). */
const place = (pc: number, low: number) => low + ((pc - low) % 12 + 12) % 12;

/** Close voicing of the chord tones inside [low, low + 14]. */
export function voicing(c: Chord, low: number, maxNotes = 4): number[] {
  const tones = c.iv.length > maxNotes ? c.iv.filter((i) => i !== 7).slice(0, maxNotes) : c.iv;
  return [...new Set(tones.map((i) => place((c.root + i) % 12, low)))].sort((a, b) => a - b);
}

/** Chord tones spread over two octaves from `low` (for arpeggios). */
export function spread(c: Chord, low: number): number[] {
  const one = c.iv.map((i) => place((c.root + i) % 12, low)).sort((a, b) => a - b);
  return [...one, ...one.map((n) => n + 12)];
}

export interface ChordSpan {
  s: number;
  l: number;
  c: Chord;
}

/** Bars written as 'Fmaj9', 'Em7 A7' (two chords split the bar). */
export function progression(bars: string[]): ChordSpan[] {
  const out: ChordSpan[] = [];
  bars.forEach((bar, i) => {
    const syms = bar.trim().split(/\s+/);
    const l = 16 / syms.length;
    syms.forEach((sym, k) => out.push({ s: i * 16 + k * l, l, c: chord(sym) }));
  });
  return out;
}

export function chordAt(prog: ChordSpan[], step: number): ChordSpan {
  for (const span of prog) if (step >= span.s && step < span.s + span.l) return span;
  return prog[prog.length - 1];
}

/**
 * Melody string: one token per `res` steps. A note name starts a note, '-'
 * holds it, '.' is a rest, '|' is ignored (bar lines). A trailing '!' accents.
 */
export function melody(str: string, res = 2, vel = 0.8, start = 0): NoteEv[] {
  const out: NoteEv[] = [];
  let step = start;
  let cur: NoteEv | null = null;
  for (const tok of str.split(/\s+/).filter((t) => t && t !== '|')) {
    if (tok === '-') {
      if (cur) cur.l += res;
    } else if (tok === '.') {
      cur = null;
    } else {
      const accent = tok.endsWith('!');
      cur = { s: step, n: note(accent ? tok.slice(0, -1) : tok), l: res, v: accent ? Math.min(1, vel * 1.25) : vel };
      out.push(cur);
    }
    step += res;
  }
  return out;
}

/** Held chords (pads, strings): one voicing per chord span. */
export function padPart(prog: ChordSpan[], low: number, vel = 0.7, maxNotes = 4): NoteEv[] {
  return prog.flatMap((sp) => voicing(sp.c, low, maxNotes).map((n) => ({ s: sp.s, n, l: sp.l, v: vel })));
}

/**
 * Chord stabs / comping on a per-bar rhythm: 'x' hit, 'X' accent, '-' hold, '.' rest.
 */
export function compPart(prog: ChordSpan[], rhythm: string, low: number, vel = 0.7, maxNotes = 4): NoteEv[] {
  const out: NoteEv[] = [];
  const bars = Math.ceil((prog[prog.length - 1].s + prog[prog.length - 1].l) / 16);
  const r = rhythm.replace(/\s|\|/g, '');
  for (let step = 0; step < bars * 16; step++) {
    const ch = r[step % r.length];
    if (ch !== 'x' && ch !== 'X') continue;
    let l = 1;
    while (r[(step + l) % r.length] === '-' && l < r.length) l++;
    const sp = chordAt(prog, step);
    for (const n of voicing(sp.c, low, maxNotes)) out.push({ s: step, n, l, v: ch === 'X' ? Math.min(1, vel * 1.3) : vel });
  }
  return out;
}

/**
 * Bass line from a per-bar pattern: 'r' root (or slash bass), 'o' octave up,
 * '5' fifth, '3' third, '7' seventh, 'b' flat second (phrygian), '-' hold, '.' rest.
 */
export function bassPart(prog: ChordSpan[], pattern: string, low: number, vel = 0.8): NoteEv[] {
  const out: NoteEv[] = [];
  const bars = Math.ceil((prog[prog.length - 1].s + prog[prog.length - 1].l) / 16);
  const p = pattern.replace(/\s|\|/g, '');
  let cur: NoteEv | null = null;
  for (let step = 0; step < bars * 16; step++) {
    const ch = p[step % p.length];
    if (ch === '-') {
      if (cur) cur.l++;
      continue;
    }
    if (ch === '.') {
      cur = null;
      continue;
    }
    const sp = chordAt(prog, step);
    const c = sp.c;
    const root = place(c.bass, low);
    const third = c.iv.find((i) => i === 3 || i === 4) ?? (c.iv.includes(5) ? 5 : 4);
    const seventh = c.iv.find((i) => i === 10 || i === 11) ?? 12;
    const offs: Record<string, number> = { r: 0, o: 12, '5': 7, '3': third, '7': seventh, b: 1 };
    const n = ch === 'r' || ch === 'o' || ch === 'b' ? root + offs[ch] : place(c.root, low) + offs[ch];
    cur = { s: step, n, l: 1, v: vel };
    out.push(cur);
  }
  return out;
}

/** Walking bass in quarters: root, chord tone, chord tone, chromatic approach to the next root. */
export function walkingBass(prog: ChordSpan[], low: number, vel = 0.75): NoteEv[] {
  const out: NoteEv[] = [];
  prog.forEach((sp, i) => {
    const next = prog[(i + 1) % prog.length];
    const root = place(sp.c.bass, low);
    const nextRoot = place(next.c.bass, low);
    const third = sp.c.iv.find((x) => x === 3 || x === 4) ?? 5;
    const beats = sp.l / 4;
    const line =
      beats >= 4
        ? [root, root + third, root + 7, nextRoot + (nextRoot > root ? -1 : 1)]
        : [root, nextRoot + (nextRoot > root + 7 ? -1 : 1)];
    line.forEach((n, k) => out.push({ s: sp.s + k * 4, n, l: 4, v: k === 0 ? vel : vel * 0.85 }));
  });
  return out;
}

/** Arpeggio: indices into the two-octave chord spread, one per `res` steps. */
export function arpPart(prog: ChordSpan[], order: number[], res: number, low: number, vel = 0.6, accentEvery = 4): NoteEv[] {
  const out: NoteEv[] = [];
  const total = prog[prog.length - 1].s + prog[prog.length - 1].l;
  let k = 0;
  for (let step = 0; step < total; step += res, k++) {
    const sp = chordAt(prog, step);
    const notes = spread(sp.c, low);
    const n = notes[order[k % order.length] % notes.length];
    out.push({ s: step, n, l: res, v: k % accentEvery === 0 ? vel : vel * 0.75 });
  }
  return out;
}

/**
 * Drum pattern (per bar, or several bars): 'x' hit, 'X' accent, 'o' ghost,
 * '.' rest. Digits 1-4 pick a pitch from `pitches` (toms).
 */
export function hits(pattern: string, bars: number, n = 60, pitches: number[] = [], fill?: { every: number; pattern: string }): NoteEv[] {
  const out: NoteEv[] = [];
  const p = pattern.replace(/\s|\|/g, '');
  const f = fill?.pattern.replace(/\s|\|/g, '');
  for (let step = 0; step < bars * 16; step++) {
    const bar = Math.floor(step / 16);
    const useFill = f && fill && (bar + 1) % fill.every === 0;
    const ch = useFill ? f![step % 16] : p[step % p.length];
    const vel = ch === 'X' ? 1 : ch === 'x' ? 0.75 : ch === 'o' ? 0.4 : /\d/.test(ch) ? 0.8 : 0;
    if (vel === 0) continue;
    const pitch = /\d/.test(ch) ? pitches[Number(ch) - 1] ?? n : n;
    out.push({ s: step, n: pitch, l: 1, v: vel });
  }
  return out;
}

/** Shift notes later by whole bars (to place a phrase). */
export const atBar = (notes: NoteEv[], bar: number): NoteEv[] => notes.map((e) => ({ ...e, s: e.s + bar * 16 }));
/** Transpose. */
export const shift = (notes: NoteEv[], semis: number, velMult = 1): NoteEv[] => notes.map((e) => ({ ...e, n: e.n + semis, v: e.v * velMult }));
