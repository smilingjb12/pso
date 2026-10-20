// A rolling record of play for bug reports (debug panel: export fight log). It keeps what reached you (each
// hit, tick and status, with your HP and where you stood), every boss telegraph (its shape, colour and the boss's
// state) and whether you were inside it when it fired, the boss's state changes, and your position a few times a
// second. Game time, in seconds; numbers rounded to centimetres. Always on: it is cheap, and a death you want
// to report has usually already happened.

export interface FightEvent {
  /** Game seconds since the page loaded. */
  t: number;
  /** What happened: 'pos', 'tele', 'fire', 'bossHit', 'hurt', 'tick', 'status', 'boss', 'area', 'death'. */
  k: string;
  [field: string]: unknown;
}

/** About an hour of play at the sampling rate (older events drop off). */
const MAX_EVENTS = 20000;
const events: FightEvent[] = [];
let clock = 0;
let teleIds = 0;

function round(v: unknown): unknown {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
}

export const fightLog = {
  get time(): number {
    return clock;
  },
  get size(): number {
    return events.length;
  },
  /** Advance its clock (once per game frame). */
  tick(dt: number): void {
    clock += dt;
  },
  push(k: string, data: Record<string, unknown> = {}): void {
    events.push({ t: Math.round(clock * 1000) / 1000, k, ...(round(data) as Record<string, unknown>) });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  },
  /** A fresh id to pair a telegraph with its firing. */
  teleId(): number {
    return ++teleIds;
  },
  clear(): void {
    events.length = 0;
  },
  /** The whole log as JSON: `header` (who, where) first, then one event per line. */
  json(header: Record<string, unknown>): string {
    const lines = events.map((e) => JSON.stringify(e));
    return `{"header":${JSON.stringify(round(header))},\n"events":[\n${lines.join(',\n')}\n]}\n`;
  },
};

/** A colour as '#rrggbb' (telegraph colours in the log). */
export function hex(color: number | undefined): string | undefined {
  return color === undefined ? undefined : `#${color.toString(16).padStart(6, '0')}`;
}
