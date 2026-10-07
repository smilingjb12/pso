import { describe, expect, it } from 'vitest';
import { Combo, type ComboSettings } from './combo';
import { hitChance } from './formulas';

const settings: ComboSettings = {
  windowOpen: 0.6,
  grace: 0.1,
  earlyPress: 'break',
  resetDelay: 0.2,
  finisherRecoveryMult: 1.5,
  perfect: 0.05,
};
const mods = {
  light: { timingMult: 1, recoveryMult: 1 },
  heavy: { timingMult: 2, recoveryMult: 1 },
};
// windup 0.1, active 0.1, recovery 0.3 => duration 0.5, window [0.3, 0.6)
const timing = () => ({ windup: 0.1, active: 0.1, recovery: 0.3 });
const make = (s: Partial<ComboSettings> = {}) => new Combo({ ...settings, ...s }, mods, timing);

function step(c: Combo, seconds: number, dt = 0.01) {
  const events = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) events.push(...c.update(dt));
  return events;
}

describe('Combo', () => {
  it('starts on first press and fires the hit after windup', () => {
    const c = make();
    expect(c.press('light')).toEqual([{ kind: 'start', hitIndex: 0, type: 'light', perfect: false }]);
    expect(step(c, 0.05).some((e) => e.kind === 'hit')).toBe(false);
    expect(step(c, 0.06).filter((e) => e.kind === 'hit')).toHaveLength(1);
  });

  it('chains when pressed inside the window', () => {
    const c = make();
    c.press('light');
    step(c, 0.4);
    expect(c.inWindow).toBe(true);
    expect(c.inPerfect).toBe(false);
    expect(c.press('heavy')).toEqual([{ kind: 'start', hitIndex: 1, type: 'heavy', perfect: false }]);
    expect(c.hitIndex).toBe(1);
    expect(c.streak).toBe(0);
  });

  it('chaining at the start of the window is perfect and builds a streak', () => {
    const c = make();
    c.press('light');
    step(c, 0.32); // window opens at 0.3, perfect until 0.35
    expect(c.inPerfect).toBe(true);
    expect(c.press('light')).toEqual([{ kind: 'start', hitIndex: 1, type: 'light', perfect: true }]);
    expect(step(c, 0.15).find((e) => e.kind === 'hit')).toEqual({ kind: 'hit', hitIndex: 1, type: 'light', streak: 1 });
    step(c, 0.17);
    expect(c.press('light')[0]).toMatchObject({ perfect: true });
    expect(c.streak).toBe(2);
  });

  it('a late chain still chains but resets the streak', () => {
    const c = make();
    c.press('light');
    step(c, 0.32);
    c.press('light');
    expect(c.streak).toBe(1);
    step(c, 0.45);
    expect(c.press('light')).toEqual([{ kind: 'start', hitIndex: 2, type: 'light', perfect: false }]);
    expect(c.streak).toBe(0);
  });

  it('weapon timing can override the perfect window and grace', () => {
    const c = new Combo(settings, mods, () => ({ windup: 0.1, active: 0.1, recovery: 0.3, perfect: 0.2, grace: 0.3 }));
    const t = c.computeTimes(0, 'light');
    expect(t.perfectCloseAt).toBeCloseTo(t.windowOpenAt + 0.2);
    expect(t.windowCloseAt).toBeCloseTo(t.duration + 0.3);
  });

  it('a sealed swing plays out without a chain window or penalty', () => {
    const c = make();
    c.press('light');
    c.seal();
    step(c, 0.35);
    expect(c.inWindow).toBe(false);
    expect(c.press('light')).toEqual([]);
    expect(step(c, 0.2)).toContainEqual({ kind: 'end', completed: false });
  });

  it('breaks the combo on an early press (anti-mash)', () => {
    const c = make();
    c.press('light');
    step(c, 0.15);
    expect(c.press('light')).toEqual([{ kind: 'early' }]);
    step(c, 0.2);
    // Window would be open now, but the combo is broken.
    expect(c.inWindow).toBe(false);
    expect(c.press('light')).toEqual([]);
    // Swing ends at its duration (no grace when broken), then reset delay.
    const ev = step(c, 0.2);
    expect(ev).toContainEqual({ kind: 'end', completed: false });
    expect(c.phase).toBe('reset');
    step(c, 0.25);
    expect(c.phase).toBe('idle');
  });

  it("ignores early presses when policy is 'ignore'", () => {
    const c = make({ earlyPress: 'ignore' });
    c.press('light');
    step(c, 0.15);
    expect(c.press('light')).toEqual([]);
    step(c, 0.2);
    expect(c.press('light')[0]).toMatchObject({ kind: 'start', hitIndex: 1 });
  });

  it('ends the combo when the window lapses', () => {
    const c = make();
    c.press('light');
    const ev = step(c, 0.65);
    expect(ev).toContainEqual({ kind: 'end', completed: false });
    expect(c.press('light')).toEqual([]); // still in reset delay
  });

  it('finisher (3rd hit) has no chain window and longer recovery', () => {
    const c = make();
    c.press('light');
    step(c, 0.35);
    c.press('light');
    step(c, 0.35);
    c.press('light');
    expect(c.hitIndex).toBe(2);
    expect(c.times.duration).toBeCloseTo(0.1 + 0.1 + 0.3 * 1.5);
    step(c, 0.4);
    expect(c.inWindow).toBe(false);
    expect(c.press('light')).toEqual([]);
    const ev = step(c, 0.3);
    expect(ev).toContainEqual({ kind: 'end', completed: true });
  });

  it('heavy attacks wind up slower', () => {
    const c = make();
    expect(c.computeTimes(0, 'heavy').hitAt).toBeCloseTo(0.2);
    expect(c.computeTimes(0, 'light').hitAt).toBeCloseTo(0.1);
  });

  it('window never opens before the active frames end', () => {
    const c = make({ windowOpen: 0.1 });
    const t = c.computeTimes(0, 'light');
    expect(t.windowOpenAt).toBeCloseTo(t.activeEnd);
  });

  it('interrupt cancels the swing', () => {
    const c = make();
    c.press('light');
    step(c, 0.05);
    c.interrupt();
    expect(c.phase).toBe('reset');
    expect(step(c, 0.3).some((e) => e.kind === 'hit')).toBe(false);
  });
});

describe('hitChance', () => {
  it('follows the PSO accuracy curve', () => {
    // 90 ATA vs 40 EVP: 90*1*1 - 8 = 82
    expect(hitChance(90, 40, 'light', 0)).toBeCloseTo(82);
    // Heavy finisher: 90*0.8*1.3 - 8 = 85.6
    expect(hitChance(90, 40, 'heavy', 2)).toBeCloseTo(85.6);
    expect(hitChance(200, 0, 'light', 2)).toBe(100);
    expect(hitChance(0, 100, 'light', 0)).toBe(0);
  });
});
