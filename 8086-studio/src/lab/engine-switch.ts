/**
 * What the Output panel holds, and what happens to it when the engine changes.
 *
 * This is a rule rather than a component, and it is here rather than inline in
 * `App.tsx` because of the bug it exists to prevent.
 *
 * The reported failure was not that the lab printed the wrong text. It was that
 * a person could not tell *whose* text they were reading: the toggle said v2, the
 * address bar said `?engine=v2`, and the panel showed a diagnostic only the legacy
 * assembler produces. Two things had gone wrong and they compounded.
 *
 * One was the dispatch — the Run button had captured the engine at load, so the
 * control and the run disagreed. That is fixed where the callback is built.
 *
 * The other was this: switching engines did not clear the Output panel. So even
 * with dispatch fixed, the previous engine's result stayed on screen under a
 * toggle that now read the other way, and nothing in the panel said which engine
 * had produced the text still sitting in it. The result of a run and the engine
 * that produced it are one thing, and they are cleared together.
 *
 * So: an engine switch replaces the panel's contents rather than leaving them,
 * whether or not a debug session was open. The note that replaces them says
 * which engine is now selected and that the previous result is gone.
 */

import type { EngineId } from '@/lab/execution-engine';
import { ENGINE_LABELS } from '@/lab/engine-choice';

/**
 * The note the Output panel shows immediately after the engine changes.
 *
 * Says the new engine, and says the old text is gone. Without the second half a
 * person cannot tell an empty panel from a cleared one, and would reasonably
 * assume the result they can still see is current.
 */
export function engineSwitchedNote(engine: EngineId): string {
  return (
    `Switched to the ${ENGINE_LABELS[engine]} engine. ` +
    'The Output panel was cleared: what it showed was produced by the other engine. ' +
    'Press Run or Debug to produce a result here.'
  );
}

/**
 * Whether a panel holding `text` is still describing the selected engine.
 *
 * A panel is stale exactly when it was produced by a different engine than the
 * one now selected. Exported so a caller that wants to grey the panel out, or
 * refuse to read it, has one definition of "stale" rather than a second one.
 */
export function isStaleForEngine(text: string, producedBy: EngineId | null, selected: EngineId): boolean {
  return text.length > 0 && producedBy !== null && producedBy !== selected;
}

/**
 * The engine a panel's current text came from, or null when it did not come from
 * a run at all.
 *
 * Null is the honest answer for a panel that has never held a result, and for one
 * cleared by an engine switch. It is deliberately not "the selected engine": that
 * would claim a provenance nobody established, which is the assumption this whole
 * file exists to stop making.
 */
export type PanelProvenance = EngineId | null;

/**
 * The panel's state after an engine switch.
 *
 * Returned whole rather than applied inside `App`, so the rule is testable and so
 * there is exactly one place that decides it. `hasDebugSession` only changes the
 * extra sentence about the closed session -- the panel is cleared either way,
 * because that was the bug.
 */
export function panelAfterEngineSwitch(
  next: EngineId,
  hasDebugSession: boolean,
): { text: string; provenance: PanelProvenance } {
  const suffix = hasDebugSession
    ? ' The debug session was running on the other engine, so it has been closed rather than relabelled.'
    : '';
  return {
    text: engineSwitchedNote(next) + suffix,
    provenance: null,
  };
}