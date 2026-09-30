/**
 * What the Output panel shows for a program that was run.
 *
 * This used to live inside `App.tsx` as a `useCallback`, which put the string
 * the user reads behind a component, a `window.prompt` call and the engine being
 * read out of `window.location`. None of that is a reason for the interesting
 * part to be unreachable from a test, and the cost of leaving it there was paid
 * for real: a program that printed nothing looked the same as a program that
 * never got its string into memory, because the only way to check was to open a
 * browser and look. The formatting and the run are here now, and `App` passes in
 * a function that asks for input, so the whole path from source text to panel
 * text is callable from a test.
 *
 * The returned string is what the panel renders, verbatim, inside a `<pre>`.
 * There is no further formatting between here and the screen.
 */

import type { ProgramOutput } from '@/emulator/cpu';
import { createSession, type EngineId } from '@/lab/execution-engine';

/**
 * Turn a stream of output entries into the text of a terminal.
 *
 * Characters accumulate onto the current line; a `number` entry is a port write
 * of a numeric value, which gets its own line. A newline character (10) commits
 * the current line. Trailing text with no newline is still emitted, because a
 * program that printed `"hello"` and halted should show `hello` and not nothing.
 */
export function formatProgramOutput(output: readonly ProgramOutput[]): string {
  let result = '';
  let currentLine = '';

  for (const item of output) {
    if (item.type === 'char') {
      if (item.value === 10) {
        result += currentLine + '\n';
        currentLine = '';
      } else {
        currentLine += String.fromCharCode(item.value);
      }
    } else {
      if (currentLine) {
        result += currentLine;
        currentLine = '';
      }
      result += item.value + '\n';
    }
  }

  if (currentLine) {
    result += currentLine;
  }

  return result;
}

/**
 * Asked for a value when a program reads from a port.
 *
 * The three outcomes are spelled out rather than collapsed into `number | null`
 * because two of them carry text the panel has to show: a cancelled run and a
 * number the person typed that is not one. Returning `NaN` for the last case
 * would have thrown the message away.
 */
export type InputRequest = (
  name: string,
  index: number,
) => { kind: 'value'; value: number } | { kind: 'cancelled' } | { kind: 'invalid'; text: string };

/** How many steps a run is allowed before it is called off. */
const DEFAULT_MAX_STEPS = 10_000;

/**
 * Assemble and run `source` on `engine`, and return the text the Output panel
 * should display.
 *
 * Assembly failures come back as text rather than as a thrown error, because a
 * person who mistypes a line should read the mistake in the panel and not in a
 * blank screen.
 */
export function runSourceToPanelText(
  engine: EngineId,
  source: string,
  requestInput?: InputRequest,
  maxSteps: number = DEFAULT_MAX_STEPS,
): string {
  const { session, diagnostics } = createSession(engine, source);
  if (session === null || diagnostics.length > 0) {
    return `Error:\n${diagnostics.map((d) => `Line ${d.line}: ${d.message}`).join('\n')}`;
  }

  const inputs: number[] = [];
  const prompts = session.inputPrompts();
  for (let i = 0; i < prompts.length; i++) {
    // With nothing to ask with, port reads get 0. A caller that wants to be asked
    // passes a function; a test that does not care about input should not have to
    // stub a prompt to get to the output.
    const request = requestInput ? requestInput(prompts[i], i + 1) : { kind: 'value' as const, value: 0 };
    if (request.kind === 'cancelled') {
      return 'Run cancelled by user.';
    }
    if (request.kind === 'invalid') {
      return `Error:\nInvalid numeric input: "${request.text}"`;
    }
    inputs.push(request.value);
  }

  const { state, output } = session.runToCompletion(inputs, maxSteps);
  const outputText = formatProgramOutput(output);
  return state.error
    ? `${outputText}\n\nError: ${state.error}`
    : `${outputText}\n\nProgram completed successfully`;
}
