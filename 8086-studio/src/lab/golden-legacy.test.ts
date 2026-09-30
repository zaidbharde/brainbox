/**
 * The legacy golden trace.
 *
 * `golden-legacy.json` was recorded at 0ebd74e -- the commit before the debug
 * view was moved onto `DebugSession` -- by stepping each shipped program the way
 * that view did it then: index the parsed instruction list and hand it to
 * `executeStepWithDiagnostics`. This test records the same programs the way the
 * current view does it, through the session, and requires the two to agree
 * exactly.
 *
 * The legacy engine has not changed since that commit, so this is not a test of
 * the emulator. It is a test of the debug layer that was refactored on top of
 * it: that going through `DebugSession` advances the program once per step,
 * produces the same registers and flags, writes the same memory, prints the same
 * output, and stops at the same place with the same error. A refactor of the
 * thing that tells a person where their program is can be wrong in ways the
 * emulator's own tests cannot see, and this is the only check that would see
 * them.
 *
 * To re-record after a change that is genuinely intended, run:
 *
 *   UPDATE_GOLDEN=1 npx vitest run src/lab/golden-legacy.test.ts
 *
 * and read the diff before committing it. A golden that moves on its own is the
 * failure this file exists to prevent, so re-recording is never the default.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildLegacyTrace, serializeTrace } from '@/lab/golden-legacy-trace';

const GOLDEN_PATH = resolve(__dirname, 'golden-legacy.json');

/**
 * Re-record on request rather than by hand.
 *
 * Deliberately not a test-time side effect: only when `UPDATE_GOLDEN` is set
 * explicitly, so an ordinary run can never quietly rewrite the thing it is
 * checking against. That is the failure mode a golden test is most prone to, and
 * it would make the file meaningless.
 *
 * An environment variable rather than a flag because vitest rejects a CLI option
 * it does not recognise, and because a flag that changes what a test *checks*
 * invites it into a plain `npm test` by accident.
 */
const RE_RECORDING = process.env.UPDATE_GOLDEN === '1';

/** The golden as recorded, which is the baseline's output, verbatim. */
function readGolden(): Record<string, string[]> {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, string[]>;
}

/**
 * The first place two traces disagree, described well enough to act on.
 *
 * Naming the program, the step and the field, rather than dumping both files, is
 * the difference between a test that gets fixed and a test that gets skipped. The
 * golden and the new value are both quoted so the change can be read without
 * opening anything.
 */
function firstDifference(
  golden: Record<string, string[]>,
  actual: Record<string, string[]>,
): string | null {
  const missing = Object.keys(golden).filter((name) => !(name in actual));
  if (missing.length > 0) return `programs no longer traced: ${missing.join(', ')}`;

  const added = Object.keys(actual).filter((name) => !(name in golden));
  if (added.length > 0) return `programs not in the golden: ${added.join(', ')}`;

  for (const name of Object.keys(golden)) {
    const expected = golden[name];
    const found = actual[name];
    for (let i = 0; i < Math.max(expected.length, found.length); i += 1) {
      if (expected[i] === found[i]) continue;
      if (expected[i] === undefined) return `${name}: the trace has steps the golden does not (first at #${i})\n  golden: end of trace\n  actual: ${found[i]}`;
      if (found[i] === undefined) return `${name}: the trace is shorter than the golden (first at #${i})\n  golden: ${expected[i]}\n  actual: end of trace`;
      return `${name}: step ${i} differs\n  golden: ${expected[i]}\n  actual: ${found[i]}`;
    }
  }
  return null;
}

describe('the legacy golden trace', () => {
  it('traces every shipped program', () => {
    // The program list is part of the golden. A sample added to the compiler and
    // not traced would leave the trace quietly covering less, and the compare
    // would still pass.
    const actual = buildLegacyTrace();
    expect(Object.keys(actual).sort()).toEqual(Object.keys(readGolden()).sort());
    expect(Object.keys(actual).length).toBeGreaterThan(0);
  });

  it('steps the legacy engine exactly as it did before the debug view moved onto the session', () => {
    const actual = buildLegacyTrace();
    const golden = readGolden();
    const difference = firstDifference(golden, actual);

    if (difference !== null && RE_RECORDING) {
      writeFileSync(GOLDEN_PATH, serializeTrace(actual), 'utf8');
      return;
    }

    if (difference !== null) {
      throw new Error(
        `the legacy debug path has changed:\n${difference}\n\n`
        + 'If this is intended, re-record with:\n'
        + '  UPDATE_GOLDEN=1 npx vitest run src/lab/golden-legacy.test.ts',
      );
    }
    expect(difference).toBeNull();
  });
});
