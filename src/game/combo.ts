import type { AttackTiming, AttackType, EarlyPressPolicy } from './config';

// PSO-style 3-hit combo state machine. Pure logic, no rendering.
//
// A swing goes windup -> active -> recovery. Late in the swing a chain window
// opens; pressing inside it immediately starts the next hit (cancelling the
// rest of the recovery). Pressing before the window either breaks the combo
// ('break', faithful PSO anti-mash) or is ignored ('ignore').
//
// The first moments of the window are the "perfect" window. Chaining there
// extends the perfect streak, which scales damage; a later press still chains
// but resets the streak. Casting uses its own Combo for cast chains.

export interface ComboSettings {
  windowOpen: number;
  grace: number;
  earlyPress: EarlyPressPolicy;
  resetDelay: number;
  finisherRecoveryMult: number;
  /** Seconds at the start of the chain window that count as a perfect chain (timing.perfect overrides). */
  perfect: number;
}

export interface AttackTypeMods {
  timingMult: number;
  recoveryMult: number;
}

export type ComboEvent =
  | { kind: 'start'; hitIndex: number; type: AttackType; perfect: boolean }
  | { kind: 'hit'; hitIndex: number; type: AttackType; streak: number }
  | { kind: 'early' }
  | { kind: 'end'; completed: boolean };

export type ComboPhase = 'idle' | 'swing' | 'reset';

export const MAX_HITS = 3;

/** A swing or cast sped up by Haste: wind-up and recovery scale by `k` (1 / (1 + Haste%)); the chain window's grace doesn't. */
export function hastened(t: AttackTiming, k: number): AttackTiming {
  return k === 1 ? t : { ...t, windup: t.windup * k, recovery: t.recovery * k };
}

export interface SwingTimes {
  hitAt: number;
  activeEnd: number;
  duration: number;
  windowOpenAt: number;
  /** End of the perfect part of the chain window. */
  perfectCloseAt: number;
  windowCloseAt: number;
}

export class Combo {
  phase: ComboPhase = 'idle';
  hitIndex = 0;
  type: AttackType = 'light';
  t = 0;
  broken = false;
  /** Broken by seal() rather than a mistimed press. */
  sealed = false;
  /** Perfect chains in a row leading into the current swing (0 on the opener or after a late chain). */
  streak = 0;
  times: SwingTimes = { hitAt: 0, activeEnd: 0, duration: 0, windowOpenAt: 0, perfectCloseAt: 0, windowCloseAt: 0 };
  /** Seconds added to the perfect window (the Mag's Rhythm passive). */
  perfectBonus = 0;
  private hitFired = false;
  private resetT = 0;

  constructor(
    private settings: ComboSettings,
    private mods: Record<AttackType, AttackTypeMods>,
    private timing: () => AttackTiming,
  ) {}

  get isFinisher(): boolean {
    return this.hitIndex === MAX_HITS - 1;
  }

  /** True while the player is committed to an attack (cannot move). */
  get committed(): boolean {
    return this.phase === 'swing';
  }

  get inWindow(): boolean {
    return (
      this.phase === 'swing' &&
      !this.broken &&
      !this.isFinisher &&
      this.t >= this.times.windowOpenAt &&
      this.t < this.times.windowCloseAt
    );
  }

  /** Inside the perfect part of the chain window. */
  get inPerfect(): boolean {
    return this.inWindow && this.t < this.times.perfectCloseAt;
  }

  /** 0..1 progress toward the window opening (for the timing cue). */
  get approach(): number {
    if (this.phase !== 'swing' || this.isFinisher || this.broken) return 0;
    return Math.min(1, this.t / this.times.windowOpenAt);
  }

  computeTimes(hitIndex: number, type: AttackType): SwingTimes {
    const base = this.timing();
    const m = this.mods[type];
    const finisher = hitIndex === MAX_HITS - 1;
    const windup = base.windup * m.timingMult;
    const recovery = base.recovery * m.recoveryMult * (finisher ? this.settings.finisherRecoveryMult : 1);
    const hitAt = windup;
    const activeEnd = windup + base.active;
    const duration = activeEnd + recovery;
    const windowOpenAt = Math.max(activeEnd, duration * this.settings.windowOpen);
    // The finisher has no follow-up, so it ends exactly at its duration.
    const windowCloseAt = finisher ? duration : duration + (base.grace ?? this.settings.grace);
    const perfectCloseAt = Math.min(windowCloseAt, windowOpenAt + (base.perfect ?? this.settings.perfect) + this.perfectBonus);
    return { hitAt, activeEnd, duration, windowOpenAt, perfectCloseAt, windowCloseAt };
  }

  /** Player pressed an attack button. Returns events produced by the press. */
  press(type: AttackType): ComboEvent[] {
    if (this.phase === 'reset') return [];
    if (this.phase === 'idle') return this.begin(0, type);

    // Mid-swing.
    if (this.isFinisher || this.broken) return [];
    if (this.t < this.times.windowOpenAt) {
      if (this.settings.earlyPress === 'break') {
        this.broken = true;
        return [{ kind: 'early' }];
      }
      return [];
    }
    if (this.t < this.times.windowCloseAt) {
      const perfect = this.t < this.times.perfectCloseAt;
      this.streak = perfect ? this.streak + 1 : 0;
      return this.begin(this.hitIndex + 1, type, perfect);
    }
    return [];
  }

  update(dt: number): ComboEvent[] {
    const events: ComboEvent[] = [];
    if (this.phase === 'reset') {
      this.resetT -= dt;
      if (this.resetT <= 0) this.phase = 'idle';
      return events;
    }
    if (this.phase !== 'swing') return events;

    this.t += dt;
    if (!this.hitFired && this.t >= this.times.hitAt) {
      this.hitFired = true;
      events.push({ kind: 'hit', hitIndex: this.hitIndex, type: this.type, streak: this.streak });
    }
    const endAt = this.broken ? this.times.duration : this.times.windowCloseAt;
    if (this.t >= endAt) {
      events.push({ kind: 'end', completed: this.isFinisher });
      this.enterReset();
    }
    return events;
  }

  /** Cancel the combo (e.g. the player got hit). */
  interrupt(): void {
    if (this.phase === 'swing') this.enterReset();
  }

  /** The current swing can't be chained from: it plays out and ends, like a broken one but without the penalty. */
  seal(): void {
    if (this.phase !== 'swing') return;
    this.broken = true;
    this.sealed = true;
  }

  private begin(hitIndex: number, type: AttackType, perfect = false): ComboEvent[] {
    if (hitIndex === 0) this.streak = 0;
    this.phase = 'swing';
    this.hitIndex = hitIndex;
    this.type = type;
    this.t = 0;
    this.broken = false;
    this.sealed = false;
    this.hitFired = false;
    this.times = this.computeTimes(hitIndex, type);
    return [{ kind: 'start', hitIndex, type, perfect }];
  }

  private enterReset(): void {
    this.phase = 'reset';
    this.resetT = this.settings.resetDelay;
    this.hitIndex = 0;
    this.streak = 0;
    this.broken = false;
  }
}
