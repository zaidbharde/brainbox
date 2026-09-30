/**
 * Which debugger controls are live, and why.
 *
 * A step is not instantaneous: it animates the pipeline, awaits, then commits a
 * new state. For those frames the session is mid-instruction, and a control that
 * fires then races the step's own `setState` — Reset is the worst case, because it
 * writes thirteen pieces of state and the step then writes its result on top of
 * (or underneath) them, leaving a debugger that claims to be at the start of the
 * program while holding a state from the middle of one.
 *
 * So the rule is: while a step is in flight, every control that would move or
 * replace the state is disabled. It is stated here, in one pure function, rather
 * than restated in six `disabled={...}` expressions — the reason it needs
 * testing is precisely that the button and the handler could otherwise disagree,
 * and a single source is the only way they cannot.
 *
 * Note what is *not* gated: Snapshot and the memory/segment pickers. Taking a
 * snapshot of a state mid-step is coherent (it is a state, just an in-between
 * one), and browsing memory never writes the session. Only controls that write
 * need the lock.
 */

import { describe, expect, it } from 'vitest';
import { debugControlAvailability } from '@/lab/debug-controls';

const READY = { halted: false, stepping: false, timelineCursor: 0 } as const;
const AT_START = { halted: false, stepping: false, timelineCursor: 3 } as const;
const STEPPING = { halted: false, stepping: true, timelineCursor: 3 } as const;
const HALTED = { halted: true, stepping: false, timelineCursor: 3 } as const;

describe('debugControlAvailability', () => {
  it('offers every control on a freshly loaded program', () => {
    // Nothing has run, so the program is at its first instruction and the
    // timeline has only the initial state on it. Stepping and rewinding both
    // start from a defined place.
    const controls = debugControlAvailability(READY);
    expect(controls.stepInto).toBe(true);
    expect(controls.stepOver).toBe(true);
    expect(controls.continueToEnd).toBe(true);
    expect(controls.reset).toBe(true);
    expect(controls.stepBack).toBe(false);
  });

  it('offers step back only once the timeline has somewhere to go', () => {
    // At cursor 0 there is no earlier state to restore. A Back button that does
    // nothing is worse than one that is visibly unavailable.
    expect(debugControlAvailability(READY).stepBack).toBe(false);
    expect(debugControlAvailability(AT_START).stepBack).toBe(true);
  });

  it('locks every state-writing control while a step is in flight', () => {
    // The point of the function. Step Into, Step Over, Continue, Back and Reset
    // all either replace the state or move the cursor while an awaited step is
    // still going to write its own result.
    const controls = debugControlAvailability(STEPPING);
    expect(controls.stepInto).toBe(false);
    expect(controls.stepOver).toBe(false);
    expect(controls.continueToEnd).toBe(false);
    expect(controls.stepBack).toBe(false);
    expect(controls.reset).toBe(false);
  });

  it('locks the controls that a halted program has nothing to run, but not reset', () => {
    // A halted program cannot step and does not need a Continue, and there is no
    // in-flight step left to race. Reset is the one control that must keep
    // working here: it is how a program that ran off the end gets restarted.
    const controls = debugControlAvailability(HALTED);
    expect(controls.stepInto).toBe(false);
    expect(controls.stepOver).toBe(false);
    expect(controls.continueToEnd).toBe(false);
    expect(controls.reset).toBe(true);
  });

  it('still locks reset if a step is in flight and the program halted underneath it', () => {
    // Not reachable from the UI today, and worth pinning anyway: `halted` and
    // `stepping` are read from separate state, so a snapshot that showed both
    // true would otherwise unlock Reset and re-create the race.
    const controls = debugControlAvailability({ halted: true, stepping: true, timelineCursor: 0 });
    expect(controls.reset).toBe(false);
    expect(controls.stepInto).toBe(false);
  });

  it('re-enables the controls once the step finishes, wherever it finished', () => {
    // "Re-enable on halt, error or stop" is the whole promise, so each ending is
    // checked: continuing on, hitting an error (which halts), and stopping at a
    // breakpoint are three different transitions and all three must hand the
    // controls back.
    for (const end of [
      { halted: false, stepping: false, timelineCursor: 4 },
      { halted: true, stepping: false, timelineCursor: 4 },
      { halted: false, stepping: false, timelineCursor: 1 },
    ]) {
      const controls = debugControlAvailability(end);
      expect(controls.reset, `reset after ${JSON.stringify(end)}`).toBe(true);
    }
  });
});
