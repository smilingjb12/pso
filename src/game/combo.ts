import type { AttackTiming, EarlyPressPolicy } from './config';

// PSO-style 3-step combo state machine. Pure logic, no rendering.
//
// A step goes windup -> active -> recovery. Late in the step a chain window opens; pressing inside it
// immediately starts the next step (cancelling the rest of the recovery). Pressing before the window either
// breaks the combo ('break', faithful PSO anti-mash) or is ignored ('ignore').
//
// A step is the basic attack or an Art (2026-10-14, the Arts redesign): basic, basic, Art is the classic chain,
// PSO2 style. Each step brings its own timing. The first moments of the window are the "perfect" window.
// Chaining there extends the perfect streak, which scales damage; a later press still chains but resets the
// streak. An Art that seals (channels, guards, movement) can't be chained from.

export interface ComboSettings {
  windowOpen: number;
  grace: number;
  earlyPress: EarlyPressPolicy;
  resetDelay: number;
  finisherRecoveryMult: number;
  /** Seconds at the start of the chain window that count as a perfect chain (timing.perfect overrides). */
  perfect: number;
}

/** What a step is: the basic attack, or an Art (by id). */
export type StepId = 'basic' | (string & {});

export type ComboEvent =
  | { kind: 'start'; hitIndex: number; step: StepId; perfect: boolean }
  | { kind: 'hit'; hitIndex: number; step: StepId; streak: number }
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
  step: StepId = 'basic';
  t = 0;
  broken = false;
  /** Broken by seal() rather than a mistimed press. */
  sealed = false;
  /** Perfect chains in a row leading into the current step (0 on the opener or after a late chain). */
  streak = 0;
  times: SwingTimes = { hitAt: 0, activeEnd: 0, duration: 0, windowOpenAt: 0, perfectCloseAt: 0, windowCloseAt: 0 };
  /** Seconds added to the perfect window (the Tempo passive). */
  perfectBonus = 0;
  private hitFired = false;
  private resetT = 0;

  constructor(
    private settings: ComboSettings,
    private timing: (step: StepId) => AttackTiming,
  ) {}

  get isFinisher(): boolean {
    return this.hitIndex === MAX_HITS - 1;
  }

  /** True while the player is committed to a step. */
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

  computeTimes(hitIndex: number, step: StepId): SwingTimes {
    const base = this.timing(step);
    const finisher = hitIndex === MAX_HITS - 1;
    const recovery = base.recovery * (finisher ? this.settings.finisherRecoveryMult : 1);
    const hitAt = base.windup;
    const activeEnd = base.windup + base.active;
    const duration = activeEnd + recovery;
    const windowOpenAt = Math.max(activeEnd, duration * this.settings.windowOpen);
    // The finisher has no follow-up, so it ends exactly at its duration.
    const windowCloseAt = finisher ? duration : duration + (base.grace ?? this.settings.grace);
    const perfectCloseAt = Math.min(windowCloseAt, windowOpenAt + (base.perfect ?? this.settings.perfect) + this.perfectBonus);
    return { hitAt, activeEnd, duration, windowOpenAt, perfectCloseAt, windowCloseAt };
  }

  /** Would pressing now start or chain a step (not break the combo, not be ignored)? */
  get canChainNow(): boolean {
    if (this.phase === 'idle') return true;
    return this.phase === 'swing' && this.inWindow;
  }

  /** Player pressed the basic attack or an Art. Returns events produced by the press. */
  press(step: StepId): ComboEvent[] {
    if (this.phase === 'reset') return [];
    if (this.phase === 'idle') return this.begin(0, step);

    // Mid-step.
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
      return this.begin(this.hitIndex + 1, step, perfect);
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
      events.push({ kind: 'hit', hitIndex: this.hitIndex, step: this.step, streak: this.streak });
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

  /** The current step can't be chained from: it plays out and ends, like a broken one but without the penalty. */
  seal(): void {
    if (this.phase !== 'swing') return;
    this.broken = true;
    this.sealed = true;
  }

  private begin(hitIndex: number, step: StepId, perfect = false): ComboEvent[] {
    if (hitIndex === 0) this.streak = 0;
    this.phase = 'swing';
    this.hitIndex = hitIndex;
    this.step = step;
    this.t = 0;
    this.broken = false;
    this.sealed = false;
    this.hitFired = false;
    this.times = this.computeTimes(hitIndex, step);
    return [{ kind: 'start', hitIndex, step, perfect }];
  }

  private enterReset(): void {
    this.phase = 'reset';
    this.resetT = this.settings.resetDelay;
    this.hitIndex = 0;
    this.streak = 0;
    this.broken = false;
  }
}
