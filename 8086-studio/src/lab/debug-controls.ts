/**
 * lab/debug-controls.ts — which debugger controls are live right now.
 *
 * The reasoning behind these rules, and the reason they are not left as six
 * `disabled={...}` expressions in the toolbar, is in `debug-controls.test.ts`.
 * The short version: a step awaits the pipeline animation and then writes state,
 * so anything that also writes state must stand aside while one is in flight.
 */

export interface DebugControlState {
  /** The program has run off the end, hit an error, or stopped at a halt. */
  halted: boolean;
  /** A step is awaiting its pipeline animation and has not committed yet. */
  stepping: boolean;
  /** Where the timeline is pointing, 0 being the state the program loaded in. */
  timelineCursor: number;
}

export interface DebugControlAvailability {
  stepInto: boolean;
  stepOver: boolean;
  continueToEnd: boolean;
  stepBack: boolean;
  reset: boolean;
}

/**
 * Resolve the toolbar for one render.
 *
 * The `stepping` lock is applied first and to everything that writes, because a
 * control that is already disabled for another reason stays disabled and the lock
 * is the stronger of the two. `reset` is the only control left enabled on a
 * halted program: restarting is what a halted program is for.
 */
export function debugControlAvailability({
  halted,
  stepping,
  timelineCursor,
}: DebugControlState): DebugControlAvailability {
  const locked = stepping;
  return {
    stepInto: !halted && !locked,
    stepOver: !halted && !locked,
    continueToEnd: !halted && !locked,
    stepBack: timelineCursor > 0 && !locked,
    reset: !locked,
  };
}
